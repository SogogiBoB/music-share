import { supabase } from "./supabaseClient.js";

export function parseYoutubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1) || null;
    }
    if (u.hostname.includes("youtube.com")) {
      return u.searchParams.get("v");
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchYoutubeTitle(videoId) {
  const res = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
  );
  if (!res.ok) throw new Error("oEmbed 조회 실패");
  const data = await res.json();
  return data.title;
}

export async function fetchTracks() {
  const { data, error } = await supabase.from("tracks").select().order("position").order("id");
  if (error) throw error;
  return data;
}

export async function addTrack({ url, uid }) {
  const videoId = parseYoutubeId(url);
  if (!videoId) throw new Error("유효하지 않은 유튜브 링크");
  const title = await fetchYoutubeTitle(videoId);
  const existing = await fetchTracks();
  const position = existing.length;
  const { error } = await supabase.from("tracks").insert({
    youtube_id: videoId,
    title,
    added_by: uid,
    position,
  });
  if (error) throw error;
  return { youtubeId: videoId, title };
}

export async function deleteTrack(trackId) {
  const { error } = await supabase.from("tracks").delete().eq("id", trackId);
  if (error) throw error;
}

export async function addTrackFromLibrary({ youtubeId, title, uid }) {
  const existing = await fetchTracks();
  if (existing.some((t) => t.youtube_id === youtubeId)) {
    throw new Error("이미 대기열에 있는 곡이에요.");
  }
  const { error } = await supabase.from("tracks").insert({
    youtube_id: youtubeId,
    title,
    added_by: uid,
    position: existing.length,
  });
  if (error) throw error;
}

export function subscribeTracks(onChange) {
  const channel = supabase
    .channel("tracks-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "tracks" }, async () => {
      onChange(await fetchTracks());
    })
    .subscribe();
  return channel;
}
