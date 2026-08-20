import { YOUTUBE_API_KEY } from "./config.js";
import { parseYoutubeId, fetchYoutubeTitle } from "./playlist.js";

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// 입력창 하나로 링크와 키워드를 모두 받기 위해 입력의 성격을 먼저 가른다.
export function classifySearchInput(rawInput) {
  const input = String(rawInput ?? "").trim();
  if (!input) return { kind: "empty" };

  const videoId = parseYoutubeId(input);
  if (videoId) return { kind: "url", videoId };

  // 유튜브 주소인데 영상 id 가 없으면(검색 결과 페이지 등) 키워드로 흘리지 않고 알려준다.
  if (/^https?:\/\//i.test(input)) return { kind: "invalid-url" };

  // 영상 id 만 복사해 온 경우(공백 없는 11자)도 링크와 같게 취급한다.
  if (VIDEO_ID_RE.test(input)) return { kind: "url", videoId: input };

  return { kind: "keyword", query: input };
}

// 링크면 그 곡 하나, 키워드면 검색 결과 목록을 돌려준다.
// 네트워크 호출은 주입받아 순수 로직만 테스트할 수 있게 한다.
export async function searchUnified({
  input,
  searchByKeyword = searchYoutube,
  fetchTitleById = fetchYoutubeTitle,
} = {}) {
  const parsed = classifySearchInput(input);
  if (parsed.kind === "empty") return [];
  if (parsed.kind === "invalid-url") throw new Error("영상 주소가 아니에요. 유튜브 링크를 다시 확인해 주세요.");
  if (parsed.kind === "url") {
    const title = await fetchTitleById(parsed.videoId);
    return [{ videoId: parsed.videoId, title }];
  }
  return searchByKeyword(parsed.query);
}

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
  if (res.status === 403) {
    // API 키의 리퍼러 제한(배포 도메인 외 접속)이나 일일 할당량 초과가 여기로 온다.
    throw new Error("지금은 곡 제목 검색을 쓸 수 없어요. 유튜브 링크로 추가해 주세요.");
  }
  if (!res.ok) throw new Error("유튜브 검색에 실패했어요. 잠시 후 다시 시도해 주세요.");
  const data = await res.json();
  return parseYoutubeSearchResults(data);
}
