-- Supabase Realtime 에서 DELETE 이벤트 시 room_id 필터가 동작하려면 REPLICA IDENTITY FULL 이 필요하다.
alter table public.tracks replica identity full;
alter table public.playback_state replica identity full;
