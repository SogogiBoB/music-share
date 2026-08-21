-- ==============================================================================
-- Sugar DJ · Music Share 전체 테이블 초기화 및 스키마 재구축 스크립트
-- Supabase 대시보드의 SQL Editor 에서 전체 복사 후 실행(Run)하면 깨끗하게 재구축됩니다.
--
-- 방(room) 구조 도입 버전. 기존 싱글턴 settings/tracks/playback_state 데이터는 폐기됩니다.
-- (supabase/migrations/ 의 파일들은 이 스크립트 이전 구조를 대상으로 하므로 더는 적용하지 않습니다.)
-- ==============================================================================

-- 1. 기존 테이블 및 함수 완전 정리 (CASCADE)
drop publication if exists supabase_realtime cascade;
drop trigger if exists playback_state_stamp_server_started_at on public.playback_state cascade;
drop function if exists public.stamp_server_started_at cascade;
drop function if exists public.server_time_ms cascade;
drop function if exists public.is_guest_uid cascade;
drop function if exists public.is_room_member cascade;
drop function if exists public.is_room_owner cascade;
drop function if exists public.create_room cascade;
drop function if exists public.join_room cascade;
drop function if exists public.leave_room cascade;
drop function if exists public.delete_room cascade;
drop function if exists public.list_rooms cascade;
-- 예전 DJ 임대 구조의 잔재
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
drop table if exists public.room_members cascade;
drop table if exists public.room_secrets cascade;
drop table if exists public.rooms cascade;
drop table if exists public.settings cascade;
drop table if exists public.profiles cascade;

-- 방 비밀번호 해시(bcrypt)에 필요하다. Supabase 는 확장을 extensions 스키마에 설치한다.
create extension if not exists pgcrypto with schema extensions;

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

-- 3. rooms (방). DJ 는 방을 만든 사람(owner_uid)으로 고정이며 바뀌지 않는다.
--    비밀번호 해시는 절대 클라이언트로 나가면 안 되므로 별도 테이블(room_secrets)에 둔다.
create table public.rooms (
  id bigint generated always as identity primary key,
  name text not null,
  owner_uid uuid not null references auth.users(id) on delete cascade,
  has_password boolean not null default false,
  master_volume int not null default 100,
  created_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

-- 방 이름·방장·잠금 여부·마스터 볼륨은 공개 정보다(목록 표시와 realtime 볼륨 동기화에 필요).
-- 쓰기는 정책을 두지 않아 직접 INSERT/UPDATE/DELETE 가 모두 막히고, 아래 RPC 로만 가능하다.
create policy "누구나 방 조회" on public.rooms
  for select using (true);

create table public.room_secrets (
  room_id bigint primary key references public.rooms(id) on delete cascade,
  password_hash text not null
);

-- 정책을 하나도 만들지 않는다 = 어떤 클라이언트도 읽을 수 없다.
-- security definer 함수(join_room)만 이 테이블에 접근한다.
alter table public.room_secrets enable row level security;

create table public.room_members (
  room_id bigint not null references public.rooms(id) on delete cascade,
  uid uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, uid)
);

alter table public.room_members enable row level security;

-- RLS 정책 안에서 room_members 를 직접 조회하면 재귀가 되므로 security definer 헬퍼로 감싼다.
create or replace function public.is_room_member(r bigint, u uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from room_members where room_id = r and uid = u);
$$;

create or replace function public.is_room_owner(r bigint, u uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from rooms where id = r and owner_uid = u);
$$;

grant execute on function public.is_room_member(bigint, uuid) to anon, authenticated;
grant execute on function public.is_room_owner(bigint, uuid) to anon, authenticated;

create policy "같은 방 멤버만 멤버 목록 조회" on public.room_members
  for select using (public.is_room_member(room_id, auth.uid()));

-- 4. 방 관련 RPC
-- 방 만들기는 정회원만 할 수 있다(게스트 차단). 만든 사람이 그대로 DJ 가 된다.
create or replace function public.create_room(p_name text, p_password text default null)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_id bigint;
  clean_name text;
  secret text;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;
  if public.is_guest_uid(auth.uid()) then
    raise exception '게스트는 방을 만들 수 없습니다';
  end if;

  clean_name := btrim(coalesce(p_name, ''));
  if clean_name = '' then
    raise exception '방 이름을 입력해 주세요';
  end if;
  if length(clean_name) > 30 then
    raise exception '방 이름은 30자 이하여야 합니다';
  end if;

  -- 공백만 입력한 비밀번호는 "비밀번호 없음"으로 본다.
  secret := nullif(btrim(coalesce(p_password, '')), '');

  insert into rooms (name, owner_uid, has_password)
    values (clean_name, auth.uid(), secret is not null)
    returning id into new_id;

  if secret is not null then
    insert into room_secrets (room_id, password_hash)
      values (new_id, crypt(p_password, gen_salt('bf')));
  end if;

  insert into playback_state (room_id) values (new_id);
  insert into room_members (room_id, uid) values (new_id, auth.uid());

  return new_id;
end;
$$;

-- 입장. 비밀번호가 걸린 방은 해시 검증을 통과해야 멤버가 된다.
create or replace function public.join_room(p_room_id bigint, p_password text default null)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  want text;
begin
  if auth.uid() is null then
    return false;
  end if;
  if not exists (select 1 from rooms where id = p_room_id) then
    return false;
  end if;

  -- 방장은 자기 방에 언제나 들어갈 수 있다. "방 나가기" 로 멤버십을 지운 뒤
  -- 자기가 건 비밀번호를 다시 입력해야 하는 상황을 막는다.
  -- 이미 멤버인 사람(새로고침·재입장)도 비밀번호를 다시 묻지 않는다.
  if not (public.is_room_owner(p_room_id, auth.uid())
          or public.is_room_member(p_room_id, auth.uid())) then
    select password_hash into want from room_secrets where room_id = p_room_id;
    if want is not null then
      if p_password is null or crypt(p_password, want) <> want then
        return false;
      end if;
    end if;
  end if;

  insert into room_members (room_id, uid) values (p_room_id, auth.uid())
    on conflict do nothing;
  return true;
end;
$$;

-- 나가기는 멤버십만 지운다. 방과 대기열은 그대로 남아 방장이 돌아오면 이어서 튼다.
create or replace function public.leave_room(p_room_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from room_members where room_id = p_room_id and uid = auth.uid();
  return found;
end;
$$;

-- 방은 저절로 사라지지 않는다. 방장이 명시적으로 지울 때만 대기열·멤버와 함께 삭제된다.
create or replace function public.delete_room(p_room_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from rooms where id = p_room_id and owner_uid = auth.uid();
  return found;
end;
$$;

-- 방 목록. 비밀번호 해시는 내보내지 않고 "잠김 여부"만 알려준다.
create or replace function public.list_rooms()
returns table (
  id bigint,
  name text,
  owner_uid uuid,
  owner_nickname text,
  has_password boolean,
  member_count bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.name,
    r.owner_uid,
    coalesce(p.nickname, '알 수 없음'),
    r.has_password,
    (select count(*) from room_members m where m.room_id = r.id),
    r.created_at
  from rooms r
  left join profiles p on p.uid = r.owner_uid
  order by r.created_at desc;
$$;

create or replace function public.set_master_volume(p_room_id bigint, v int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if v < 0 or v > 100 then
    return false;
  end if;
  update rooms
    set master_volume = v
    where id = p_room_id and owner_uid = auth.uid();
  return found;
end;
$$;

grant execute on function public.create_room(text, text) to authenticated;
grant execute on function public.join_room(bigint, text) to anon, authenticated;
grant execute on function public.leave_room(bigint) to anon, authenticated;
grant execute on function public.delete_room(bigint) to authenticated;
grant execute on function public.list_rooms() to anon, authenticated;
grant execute on function public.set_master_volume(bigint, int) to authenticated;

-- 5. tracks (방별 대기열)
create table public.tracks (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms(id) on delete cascade,
  youtube_id text not null,
  title text not null,
  added_by uuid not null references auth.users(id) on delete cascade,
  position int not null,
  created_at timestamptz not null default now()
);

create index tracks_room_id_idx on public.tracks (room_id, position);

alter table public.tracks enable row level security;

create policy "방 멤버만 대기열 조회" on public.tracks
  for select using (public.is_room_member(room_id, auth.uid()));

create policy "방장만 트랙 추가" on public.tracks
  for insert with check (
    added_by = auth.uid() and public.is_room_owner(room_id, auth.uid())
  );

create policy "방장만 트랙 삭제" on public.tracks
  for delete using (public.is_room_owner(room_id, auth.uid()));

-- 6. playback_state (방당 1행)
create table public.playback_state (
  room_id bigint primary key references public.rooms(id) on delete cascade,
  current_track_id bigint references public.tracks(id) on delete set null,
  is_playing boolean not null default false,
  position_at_start numeric not null default 0,
  server_started_at timestamptz not null default now()
);

alter table public.playback_state enable row level security;

create policy "방 멤버만 재생상태 조회" on public.playback_state
  for select using (public.is_room_member(room_id, auth.uid()));

create policy "방장만 재생상태 변경" on public.playback_state
  for update using (public.is_room_owner(room_id, auth.uid()))
  with check (public.is_room_owner(room_id, auth.uid()));

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

-- 7. 개인 재생목록 (방과 무관하게 유저 단위로 유지)
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

-- 8. Realtime 활성화
-- rooms 는 마스터 볼륨 동기화 때문에 필요하다.
create publication supabase_realtime for table public.tracks, public.playback_state, public.rooms;
