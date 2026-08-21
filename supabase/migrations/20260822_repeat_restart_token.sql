-- 한곡 반복(또는 트랙 1개짜리 전체 반복)에서 곡이 끝나도 자동으로 다시 재생되지 않던 문제.
--
-- 같은 트랙을 position_at_start=0 으로 다시 시작하면 UPDATE 전후의
-- current_track_id · is_playing · position_at_start 가 모두 같아서
-- stamp_server_started_at 이 "값이 안 바뀐 UPDATE" 로 판단하고 server_started_at 을
-- 재각인하지 않았다. 그러면 모든 클라이언트가 곡이 처음 시작한 시각(T0)을 기준으로
-- 위치를 계산해 expected 가 곡 길이를 넘고, computeSeekTarget 이 null 을 돌려주면서
-- 아무도 0초로 되감지 않는다(= 재생 재개 실패).
--
-- 곡을 한 번이라도 일시정지했다면 position_at_start 가 0 이 아니어서 재각인이 일어나므로
-- 증상이 간헐적으로만 보였다.
--
-- 값만으로는 "의도된 재시작"과 "값이 안 바뀐 UPDATE"를 구분할 수 없으므로,
-- 클라이언트가 매번 새 restart_token 을 실어 재시작 의도를 명시한다.

alter table public.playback_state
  add column if not exists restart_token text;

create or replace function public.stamp_server_started_at()
returns trigger
language plpgsql
as $$
begin
  -- is_playing 이 true 로 새로 시작되거나, 재생 중 곡(current_track_id) 또는
  -- 시작위치(position_at_start)가 변경되거나, 클라이언트가 명시적으로 재시작을
  -- 요청(restart_token 변경)할 때만 server_started_at 을 갱신한다.
  if new.is_playing and (
    old.is_playing is distinct from true or
    old.current_track_id is distinct from new.current_track_id or
    old.position_at_start is distinct from new.position_at_start or
    old.restart_token is distinct from new.restart_token
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
