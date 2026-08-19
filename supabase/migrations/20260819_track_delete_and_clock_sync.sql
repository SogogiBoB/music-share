-- 기존 Supabase 프로젝트에 한 번만 적용하는 마이그레이션.
-- 1) DJ가 재생목록에서 곡을 삭제할 수 있게 한다.
-- 2) 재생 중인 곡이 삭제돼도 playback_state 갱신이 FK 위반으로 막히지 않게 한다.
-- 3) DJ-리스너 시계 오차로 인한 재생 위치 오차를 없앤다.

drop policy if exists "DJ만 트랙 삭제" on public.tracks;
create policy "DJ만 트랙 삭제" on public.tracks
  for delete using (
    exists (select 1 from public.settings where dj_uid = auth.uid())
  );

alter table public.playback_state
  drop constraint if exists playback_state_current_track_id_fkey;

alter table public.playback_state
  add constraint playback_state_current_track_id_fkey
  foreign key (current_track_id) references public.tracks(id) on delete set null;

create or replace function public.stamp_server_started_at()
returns trigger
language plpgsql
as $$
begin
  if new.is_playing then
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

create or replace function public.server_time_ms()
returns bigint
language sql
stable
as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

grant execute on function public.server_time_ms() to anon, authenticated;
