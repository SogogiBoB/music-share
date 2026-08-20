import { supabase } from "./supabaseClient.js";
import { normalizeTitle, normalizeTrackTitles } from "./titleText.js";

export function parseYoutubeId(url) {
  try {
    const u = new URL(String(url).trim());
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    if (u.hostname.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      // /shorts/ID, /embed/ID, /live/ID 형태도 같은 영상을 가리킨다.
      const [section, id] = u.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live", "v"].includes(section) && id) return id;
      return null;
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
  return normalizeTitle(data.title);
}

export async function fetchTracks() {
  const { data, error } = await supabase.from("tracks").select().order("position").order("id");
  if (error) throw error;
  // 이스케이프된 채로 저장된 기존 행도 화면에서는 제대로 보이게 한다.
  return normalizeTrackTitles(data);
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

// 대기열은 같은 곡을 여러 번 트는 걸 허용한다. 중복 검사는 내 재생목록 쪽에만 둔다.
export async function addTrackFromLibrary({ youtubeId, title, uid }) {
  const existing = await fetchTracks();
  const { error } = await supabase.from("tracks").insert({
    youtube_id: youtubeId,
    title: normalizeTitle(title),
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
