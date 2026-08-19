import { supabase } from "./supabaseClient.js";

export function hasDuplicateTrack(tracks, youtubeId) {
  return tracks.some((t) => t.youtube_id === youtubeId);
}

export function partitionLibraryTracks(libraryTracks, queueTracks) {
  const addable = [];
  const already = [];
  libraryTracks.forEach((t) => {
    (hasDuplicateTrack(queueTracks, t.youtube_id) ? already : addable).push(t);
  });
  return { addable, already };
}

export function computeReorderedPositions(tracks, fromIndex, toIndex) {
  const reordered = tracks.slice();
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered.map((t, index) => ({ ...t, position: index }));
}

export function filterPlaylistsByQuery(playlistsWithTracks, query) {
  const term = query.trim().toLowerCase();
  if (!term) return playlistsWithTracks;
  return playlistsWithTracks.filter((p) =>
    p.tracks.some((t) => t.title.toLowerCase().includes(term))
  );
}

export async function fetchPlaylists(ownerUid) {
  const { data, error } = await supabase
    .from("playlists")
    .select()
    .eq("owner_uid", ownerUid)
    .order("created_at");
  if (error) throw error;
  return data;
}

export async function createPlaylist({ name, ownerUid }) {
  const { data, error } = await supabase
    .from("playlists")
    .insert({ name, owner_uid: ownerUid })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function renamePlaylist(playlistId, name) {
  const { error } = await supabase.from("playlists").update({ name }).eq("id", playlistId);
  if (error) throw error;
}

export async function deletePlaylist(playlistId) {
  const { error } = await supabase.from("playlists").delete().eq("id", playlistId);
  if (error) throw error;
}

export async function fetchPlaylistTracks(playlistId) {
  const { data, error } = await supabase
    .from("playlist_tracks")
    .select()
    .eq("playlist_id", playlistId)
    .order("position");
  if (error) throw error;
  return data;
}

export async function fetchAllPlaylistsWithTracks(ownerUid) {
  const playlists = await fetchPlaylists(ownerUid);
  const withTracks = await Promise.all(
    playlists.map(async (p) => ({ ...p, tracks: await fetchPlaylistTracks(p.id) }))
  );
  return withTracks;
}

export async function addTrackToPlaylist({ playlistId, youtubeId, title }) {
  const existing = await fetchPlaylistTracks(playlistId);
  if (hasDuplicateTrack(existing, youtubeId)) {
    throw new Error("이미 이 재생목록에 있는 곡이에요.");
  }
  const { error } = await supabase.from("playlist_tracks").insert({
    playlist_id: playlistId,
    youtube_id: youtubeId,
    title,
    position: existing.length,
  });
  if (error) throw error;
}

export async function removeTrackFromPlaylist(trackId) {
  const { error } = await supabase.from("playlist_tracks").delete().eq("id", trackId);
  if (error) throw error;
}

export async function moveTrackToPlaylist({ trackId, targetPlaylistId }) {
  const { data: track, error: fetchError } = await supabase
    .from("playlist_tracks")
    .select()
    .eq("id", trackId)
    .single();
  if (fetchError) throw fetchError;

  const targetTracks = await fetchPlaylistTracks(targetPlaylistId);
  if (hasDuplicateTrack(targetTracks, track.youtube_id)) {
    throw new Error("이미 그 재생목록에 있는 곡이에요.");
  }

  const { error: insertError } = await supabase.from("playlist_tracks").insert({
    playlist_id: targetPlaylistId,
    youtube_id: track.youtube_id,
    title: track.title,
    position: targetTracks.length,
  });
  if (insertError) throw insertError;

  const { error: deleteError } = await supabase.from("playlist_tracks").delete().eq("id", trackId);
  if (deleteError) throw deleteError;
}

export async function persistReorder(reorderedTracks) {
  const updates = reorderedTracks.map((t) =>
    supabase.from("playlist_tracks").update({ position: t.position }).eq("id", t.id)
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}
