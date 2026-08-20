// 유튜브 API(검색·oEmbed)는 곡 제목을 HTML 이스케이프한 문자열로 돌려준다.
// 화면은 textContent 로 그리기 때문에 "Don&#39;t Stop" 처럼 엔티티가 그대로 보인다.
// 데이터가 앱으로 들어오는 경계에서 한 번만 풀어 두고, 그 뒤 코드는 사람이 읽는
// 제목만 다루게 한다.
const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const ENTITY_RE = /&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g;

// 검색 API 는 이미 이스케이프된 제목을 한 번 더 이스케이프해 주는 경우가 있어
// (`&amp;#39;`) 더 이상 변하지 않을 때까지 푼다. 무한 루프 방지로 횟수를 제한한다.
const MAX_PASSES = 3;

function decodeOnce(input) {
  return input.replace(ENTITY_RE, (match, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function decodeHtmlEntities(text) {
  let current = String(text ?? "");
  for (let pass = 0; pass < MAX_PASSES && current.includes("&"); pass += 1) {
    const next = decodeOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

// 곡 제목이 화면·검색·저장 어디로 가든 같은 형태가 되게 맞춘다.
export function normalizeTitle(text) {
  return decodeHtmlEntities(text).trim();
}

export function normalizeTrackTitles(tracks) {
  if (!Array.isArray(tracks)) return tracks;
  return tracks.map((t) => (t && typeof t === "object" ? { ...t, title: normalizeTitle(t.title) } : t));
}
