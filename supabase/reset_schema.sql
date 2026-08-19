-- ==============================================================================
-- Sugar DJ · Music Share 전체 테이블 초기화 및 스키마 재구축 스크립트
-- Supabase 대시보드의 SQL Editor 에서 전체 복사 후 실행(Run)하면 깨끗하게 재구축됩니다.
-- ==============================================================================

-- 1. 기존 테이블 및 함수 완전 정리 (CASCADE)
drop publication if exists supabase_realtime cascade;
drop trigger if exists playback_state_stamp_server_started_at on public.playback_state cascade;
drop function if exists public.stamp_server_started_at cascade;
drop function if exists public.server_time_ms cascade;
drop function if exists public.is_guest_uid cascade;
drop function if exists public.claim_dj cascade;
drop function if exists public.heartbeat_dj cascade;
drop function if exists public.takeover_dj cascade;
drop function if exists public.delegate_dj cascade;
drop function if exists public.release_dj cascade;
drop function if exists public.set_master_volume cascade;

drop table if exists public.playlist_tracks cascade;
drop table if exists public.playlists cascade;
drop table if exists public.playback_state cascade;
drop table if exists public.tracks cascade;
drop table if exists public.settings cascade;
drop table if exists public.profiles cascade;

-- 2. profiles 테이블 (유저 프로필 및 게스트 여부)
create table public.profiles (
  uid uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  is_guest boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "누구나 프로필 조회" on public.profiles
  for select using (true);

create policy "본인 프로필만 생성" on public.profiles
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

create policy "본인 프로필만 수정" on public.profiles
  for update using (auth.uid() = uid)
  with check (auth.uid() = uid and is_guest = public.is_guest_uid(auth.uid()));

-- 3. settings 테이블 (방 설정, DJ 권한 및 마스터 볼륨)
create table public.settings (
  id int primary key default 1,
  dj_uid uuid references auth.users(id) on delete set null,
  dj_lease_expires_at timestamptz,
  master_volume int not null default 100,
  constraint singleton check (id = 1)
);

insert into public.settings (id, dj_uid, dj_lease_expires_at, master_volume)
values (1, null, null, 100)
on conflict (id) do update
  set dj_uid = null, dj_lease_expires_at = null, master_volume = 100;

alter table public.settings enable row level security;

create policy "누구나 settings 조회" on public.settings
  for select using (true);

create or replace function public.claim_dj()
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

create or replace function public.heartbeat_dj()
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

create or replace function public.takeover_dj()
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

create or replace function public.delegate_dj(target_uid uuid)
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

create or replace function public.release_dj()
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

create or replace function public.set_master_volume(v int)
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

grant execute on function public.claim_dj() to anon, authenticated;
grant execute on function public.heartbeat_dj() to anon, authenticated;
grant execute on function public.takeover_dj() to anon, authenticated;
grant execute on function public.delegate_dj(uuid) to anon, authenticated;
grant execute on function public.release_dj() to anon, authenticated;
grant execute on function public.set_master_volume(int) to anon, authenticated;

-- 4. tracks 테이블 (공유 재생 대기열)
create table public.tracks (
  id bigint generated always as identity primary key,
  youtube_id text not null,
  title text not null,
  added_by uuid not null references auth.users(id) on delete cascade,
  position int not null,
  created_at timestamptz not null default now()
);

alter table public.tracks enable row level security;

create policy "누구나 재생목록 조회" on public.tracks
  for select using (true);

create policy "DJ만 트랙 추가" on public.tracks
  for insert with check (
    added_by = auth.uid()
    and exists (select 1 from settings where dj_uid = auth.uid())
  );

create policy "DJ만 트랙 삭제" on public.tracks
  for delete using (
    exists (select 1 from settings where dj_uid = auth.uid())
  );

-- 5. playback_state 테이블 (현재 재생 상태 싱글턴)
create table public.playback_state (
  id int primary key default 1,
  current_track_id bigint references tracks(id) on delete set null,
  is_playing boolean not null default false,
  position_at_start numeric not null default 0,
  server_started_at timestamptz not null default now(),
  constraint singleton check (id = 1)
);

insert into public.playback_state (id, current_track_id, is_playing, position_at_start)
values (1, null, false, 0)
on conflict (id) do update
  set current_track_id = null, is_playing = false, position_at_start = 0;

alter table public.playback_state enable row level security;

create policy "누구나 재생상태 조회" on public.playback_state
  for select using (true);

create policy "DJ만 재생상태 변경" on public.playback_state
  for update using (
    exists (select 1 from settings where dj_uid = auth.uid())
  );

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

create trigger playback_state_stamp_server_started_at
  before update on public.playback_state
  for each row
  execute function public.stamp_server_started_at();

create or replace function public.server_time_ms()
returns bigint
language sql
stable
as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

grant execute on function public.server_time_ms() to anon, authenticated;

-- 6. playlists & playlist_tracks (유저별 개인 라이브러리)
create table public.playlists (
  id bigint generated always as identity primary key,
  owner_uid uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.playlists enable row level security;

create policy "본인 재생목록만 조회" on public.playlists
  for select using (owner_uid = auth.uid() and not public.is_guest_uid(auth.uid()));

create policy "본인 재생목록만 생성" on public.playlists
  for insert with check (owner_uid = auth.uid() and not public.is_guest_uid(auth.uid()));

create policy "본인 재생목록만 수정" on public.playlists
  for update using (owner_uid = auth.uid());

create policy "본인 재생목록만 삭제" on public.playlists
  for delete using (owner_uid = auth.uid());

create table public.playlist_tracks (
  id bigint generated always as identity primary key,
  playlist_id bigint not null references public.playlists(id) on delete cascade,
  youtube_id text not null,
  title text not null,
  position int not null,
  created_at timestamptz not null default now(),
  unique (playlist_id, youtube_id)
);

alter table public.playlist_tracks enable row level security;

create policy "본인 재생목록의 곡만 조회" on public.playlist_tracks
  for select using (
    exists (select 1 from public.playlists where id = playlist_id and owner_uid = auth.uid())
  );

create policy "본인 재생목록의 곡만 추가" on public.playlist_tracks
  for insert with check (
    exists (select 1 from public.playlists where id = playlist_id and owner_uid = auth.uid())
  );

create policy "본인 재생목록의 곡만 수정" on public.playlist_tracks
  for update using (
    exists (select 1 from public.playlists where id = playlist_id and owner_uid = auth.uid())
  );

create policy "본인 재생목록의 곡만 삭제" on public.playlist_tracks
  for delete using (
    exists (select 1 from public.playlists where id = playlist_id and owner_uid = auth.uid())
  );

-- 7. Realtime 활성화
create publication supabase_realtime for table public.tracks, public.playback_state, public.settings;
