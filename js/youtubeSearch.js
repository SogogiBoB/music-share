import { YOUTUBE_API_KEY } from "./config.js";

export function parseYoutubeSearchResults(apiJson) {
  const items = apiJson?.items ?? [];
  return items
    .filter((item) => item.id?.videoId)
    .map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet?.title ?? "",
    }));
}

export async function searchYoutube(query) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "10");
  url.searchParams.set("q", query);
  url.searchParams.set("key", YOUTUBE_API_KEY);
  const res = await fetch(url);
  if (!res.ok) throw new Error("유튜브 검색 실패");
  const data = await res.json();
  return parseYoutubeSearchResults(data);
}
