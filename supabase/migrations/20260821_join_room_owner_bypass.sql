-- 방장이 자기 방에서 나간 뒤 재입장할 때 자기 비밀번호를 다시 묻던 문제 수정.
-- Supabase SQL Editor 에 이 파일 내용만 붙여 실행하면 된다(전체 초기화 불필요).

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
