-- 기존 Supabase 프로젝트에 한 번만 적용하는 DJ heartbeat 임대 migration.
alter table public.settings
  add column if not exists dj_lease_expires_at timestamptz;

-- 이전 구현이 남긴 DJ UID는 heartbeat 만료로 처리해 새 리스너가 회수할 수 있게 한다.
update public.settings
  set dj_lease_expires_at = now() - interval '1 second'
  where dj_uid is not null and dj_lease_expires_at is null;

create or replace function public.claim_dj()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
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

grant execute on function public.claim_dj() to anon, authenticated;
grant execute on function public.heartbeat_dj() to anon, authenticated;
grant execute on function public.takeover_dj() to anon, authenticated;
grant execute on function public.delegate_dj(uuid) to anon, authenticated;
grant execute on function public.release_dj() to anon, authenticated;
