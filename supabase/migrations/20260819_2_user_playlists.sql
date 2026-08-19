-- 유저별 개인 재생목록 기능 추가.
-- 공유 재생큐(tracks/playback_state)와는 완전히 분리된 테이블.

create table public.playlists (
  id bigint generated always as identity primary key,
  owner_uid uuid not null references auth.users(id),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.playlists enable row level security;

create policy "본인 재생목록만 조회" on public.playlists
  for select using (owner_uid = auth.uid());

create policy "본인 재생목록만 생성" on public.playlists
  for insert with check (owner_uid = auth.uid());

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
