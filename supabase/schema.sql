-- profiles
create table profiles (
  uid uuid primary key references auth.users(id),
  nickname text not null,
  is_guest boolean not null default false,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "누구나 프로필 조회" on profiles
  for select using (true);

create policy "본인 프로필만 생성" on profiles
  for insert with check (auth.uid() = uid);

create or replace function public.is_guest_uid(u uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_guest from profiles where uid = u), false);
$$;

grant execute on function public.is_guest_uid(uuid) to anon, authenticated;

create policy "본인 프로필만 수정" on profiles
  for update using (auth.uid() = uid)
  with check (auth.uid() = uid and is_guest = public.is_guest_uid(auth.uid()));

-- settings (싱글턴, 현재 DJ)
create table settings (
  id int primary key default 1,
  dj_uid uuid references auth.users(id),
  dj_lease_expires_at timestamptz,
  master_volume int not null default 100,
  constraint singleton check (id = 1)
);

insert into settings (id, dj_uid, dj_lease_expires_at) values (1, null, null);

alter table settings enable row level security;

create policy "누구나 settings 조회" on settings
  for select using (true);

create or replace function claim_dj()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_guest_uid(auth.uid()) then
    return false;
  end if;
  update settings
    set dj_uid = auth.uid(), dj_lease_expires_at = now() + interval '45 seconds'
    where id = 1 and (dj_uid is null or dj_lease_expires_at <= now());
  return found;
end;
$$;

create or replace function heartbeat_dj()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update settings
    set dj_lease_expires_at = now() + interval '45 seconds'
    where id = 1 and dj_uid = auth.uid();
  return found;
end;
$$;

create or replace function takeover_dj()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_guest_uid(auth.uid()) then
    return false;
  end if;
  update settings
    set dj_uid = auth.uid(), dj_lease_expires_at = now() + interval '45 seconds'
    where id = 1;
  return found;
end;
$$;

create or replace function delegate_dj(target_uid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_guest_uid(target_uid) then
    return false;
  end if;
  update settings
    set dj_uid = target_uid, dj_lease_expires_at = now() + interval '45 seconds'
    where id = 1 and dj_uid = auth.uid();
  return found;
end;
$$;

-- DJ 가 나가면 dj_uid 를 비워 다음 사람이 claim_dj() 로 이어받을 수 있게 한다.
-- (탭이 정상 종료될 때만 호출되는 best-effort. 강제 종료/크래시는 커버하지 못한다.)
create or replace function release_dj()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update settings
    set dj_uid = null, dj_lease_expires_at = null
    where id = 1 and dj_uid = auth.uid();
  return found;
end;
$$;

create or replace function set_master_volume(v int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if v < 0 or v > 100 then
    return false;
  end if;
  update settings
    set master_volume = v
    where id = 1 and dj_uid = auth.uid();
  return found;
end;
$$;

grant execute on function claim_dj() to anon, authenticated;
grant execute on function heartbeat_dj() to anon, authenticated;
grant execute on function takeover_dj() to anon, authenticated;
grant execute on function delegate_dj(uuid) to anon, authenticated;
grant execute on function release_dj() to anon, authenticated;
grant execute on function set_master_volume(int) to anon, authenticated;

-- tracks (재생목록)
create table tracks (
  id bigint generated always as identity primary key,
  youtube_id text not null,
  title text not null,
  added_by uuid not null references auth.users(id),
  position int not null,
  created_at timestamptz not null default now()
);

alter table tracks enable row level security;

create policy "누구나 재생목록 조회" on tracks
  for select using (true);

create policy "DJ만 트랙 추가" on tracks
  for insert with check (
    added_by = auth.uid()
    and exists (select 1 from settings where dj_uid = auth.uid())
  );

create policy "DJ만 트랙 삭제" on tracks
  for delete using (
    exists (select 1 from settings where dj_uid = auth.uid())
  );

-- playback_state (싱글턴, 현재 재생 상태)
create table playback_state (
  id int primary key default 1,
  current_track_id bigint references tracks(id) on delete set null,
  is_playing boolean not null default false,
  position_at_start numeric not null default 0,
  server_started_at timestamptz not null default now(),
  constraint singleton check (id = 1)
);

insert into playback_state (id) values (1);

alter table playback_state enable row level security;

create policy "누구나 재생상태 조회" on playback_state
  for select using (true);

create policy "DJ만 재생상태 변경" on playback_state
  for update using (
    exists (select 1 from settings where dj_uid = auth.uid())
  );

-- DJ 클라이언트 시계가 어긋나면 server_started_at 을 신뢰할 수 없다.
-- 재생을 시작/재개할 때는 항상 DB 서버 시각으로 강제 고정한다.
-- 단, 이미 재생 중인 상태에서 불필요한 UPDATE 로 인해 server_started_at 이 갱신되어
-- 재생 중인 음악이 0초로 리셋되는 버그를 방지하기 위해 변경 조건이 충족될 때만 갱신한다.
create or replace function public.stamp_server_started_at()
returns trigger
language plpgsql
as $$
begin
  if new.is_playing and (
    old.is_playing is distinct from true or
    old.current_track_id is distinct from new.current_track_id or
    old.position_at_start is distinct from new.position_at_start
  ) then
    new.server_started_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists playback_state_stamp_server_started_at on public.playback_state;
create trigger playback_state_stamp_server_started_at
  before update on public.playback_state
  for each row
  execute function public.stamp_server_started_at();

-- 리스너가 자신의 로컬 시계와 서버 시계의 오프셋을 계산할 수 있게 하는 시간 소스.
create or replace function public.server_time_ms()
returns bigint
language sql
stable
as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

grant execute on function public.server_time_ms() to anon, authenticated;

-- Realtime 활성화
alter publication supabase_realtime add table tracks;
alter publication supabase_realtime add table playback_state;
alter publication supabase_realtime add table settings;

-- 유저별 개인 재생목록 (공유 재생큐와 완전 분리)
create table playlists (
  id bigint generated always as identity primary key,
  owner_uid uuid not null references auth.users(id),
  name text not null,
  created_at timestamptz not null default now()
);

alter table playlists enable row level security;

create policy "본인 재생목록만 조회" on playlists
  for select using (owner_uid = auth.uid() and not public.is_guest_uid(auth.uid()));

create policy "본인 재생목록만 생성" on playlists
  for insert with check (owner_uid = auth.uid() and not public.is_guest_uid(auth.uid()));

create policy "본인 재생목록만 수정" on playlists
  for update using (owner_uid = auth.uid());

create policy "본인 재생목록만 삭제" on playlists
  for delete using (owner_uid = auth.uid());

create table playlist_tracks (
  id bigint generated always as identity primary key,
  playlist_id bigint not null references playlists(id) on delete cascade,
  youtube_id text not null,
  title text not null,
  position int not null,
  created_at timestamptz not null default now(),
  unique (playlist_id, youtube_id)
);

alter table playlist_tracks enable row level security;

create policy "본인 재생목록의 곡만 조회" on playlist_tracks
  for select using (
    exists (select 1 from playlists where id = playlist_id and owner_uid = auth.uid())
  );

create policy "본인 재생목록의 곡만 추가" on playlist_tracks
  for insert with check (
    exists (select 1 from playlists where id = playlist_id and owner_uid = auth.uid())
  );

create policy "본인 재생목록의 곡만 수정" on playlist_tracks
  for update using (
    exists (select 1 from playlists where id = playlist_id and owner_uid = auth.uid())
  );

create policy "본인 재생목록의 곡만 삭제" on playlist_tracks
  for delete using (
    exists (select 1 from playlists where id = playlist_id and owner_uid = auth.uid())
  );
