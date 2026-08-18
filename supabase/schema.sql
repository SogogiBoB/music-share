-- profiles
create table profiles (
  uid uuid primary key references auth.users(id),
  nickname text not null,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "누구나 프로필 조회" on profiles
  for select using (true);

create policy "본인 프로필만 생성" on profiles
  for insert with check (auth.uid() = uid);

create policy "본인 프로필만 수정" on profiles
  for update using (auth.uid() = uid);

-- settings (싱글턴, 현재 DJ)
create table settings (
  id int primary key default 1,
  dj_uid uuid references auth.users(id),
  constraint singleton check (id = 1)
);

insert into settings (id, dj_uid) values (1, null);

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
  update settings set dj_uid = auth.uid() where id = 1 and dj_uid is null;
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
  update settings set dj_uid = target_uid where id = 1 and dj_uid = auth.uid();
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
  update settings set dj_uid = null where id = 1 and dj_uid = auth.uid();
  return found;
end;
$$;

grant execute on function claim_dj() to anon, authenticated;
grant execute on function delegate_dj(uuid) to anon, authenticated;
grant execute on function release_dj() to anon, authenticated;

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

-- playback_state (싱글턴, 현재 재생 상태)
create table playback_state (
  id int primary key default 1,
  current_track_id bigint references tracks(id),
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

-- Realtime 활성화
alter publication supabase_realtime add table tracks;
alter publication supabase_realtime add table playback_state;
alter publication supabase_realtime add table settings;
