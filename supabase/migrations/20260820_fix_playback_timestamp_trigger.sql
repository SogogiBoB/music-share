-- playback_state 테이블에서 불필요하게 server_started_at 이 now() 로 덮어써져서
-- 재생 중인 음악이 0초로 리셋되는 현상을 방지한다.
create or replace function public.stamp_server_started_at()
returns trigger
language plpgsql
as $$
begin
  -- is_playing 이 true 로 새로 시작되거나, 재생 중 곡(current_track_id) 또는 시작위치(position_at_start)가 변경될 때만 server_started_at 을 갱신한다.
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
