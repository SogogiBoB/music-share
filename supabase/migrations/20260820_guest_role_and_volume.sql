-- 1) 게스트 표식. presence 메타는 조작 가능하므로 권한 판단은 이 컬럼으로만 한다.
alter table profiles add column if not exists is_guest boolean not null default false;

-- 본인 행이라도 is_guest 를 스스로 false 로 바꿔 회원 권한을 얻을 수 없어야 한다.
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

drop policy if exists "본인 프로필만 수정" on profiles;
create policy "본인 프로필만 수정" on profiles
  for update using (auth.uid() = uid)
  with check (auth.uid() = uid and is_guest = public.is_guest_uid(auth.uid()));

-- 2) 게스트는 DJ가 될 수 없고, 위임 대상도 될 수 없다.
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

-- 3) 게스트는 개인 재생목록에 접근할 수 없다.
drop policy if exists "본인 재생목록만 조회" on playlists;
create policy "본인 재생목록만 조회" on playlists
  for select using (owner_uid = auth.uid() and not public.is_guest_uid(auth.uid()));

drop policy if exists "본인 재생목록만 생성" on playlists;
create policy "본인 재생목록만 생성" on playlists
  for insert with check (owner_uid = auth.uid() and not public.is_guest_uid(auth.uid()));

-- 4) 마스터 볼륨(방 전체 기준값). DJ만 바꿀 수 있다.
alter table settings add column if not exists master_volume int not null default 100;

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

grant execute on function set_master_volume(int) to anon, authenticated;
