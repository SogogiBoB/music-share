import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYoutubeId } from "../js/playlist.js";
import { computeExpectedPosition } from "../js/player.js";

test("스캐폴드 확인", () => {
  assert.equal(1 + 1, 2);
});

test("일반 워치 URL에서 video id 추출", () => {
  assert.equal(parseYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("단축 youtu.be URL에서 video id 추출", () => {
  assert.equal(parseYoutubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("추가 쿼리파라미터가 있어도 video id 추출", () => {
  assert.equal(parseYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=abc"), "dQw4w9WgXcQ");
});

test("유효하지 않은 URL이면 null", () => {
  assert.equal(parseYoutubeId("https://example.com"), null);
});

test("재생 중이면 경과시간만큼 위치가 앞으로 감", () => {
  const serverStartedAt = new Date(Date.now() - 3000).toISOString();
  const pos = computeExpectedPosition({ isPlaying: true, positionAtStart: 10, serverStartedAt });
  assert.ok(pos >= 12.9 && pos <= 13.1, `expected ~13, got ${pos}`);
});

test("일시정지 상태면 positionAtStart 그대로", () => {
  const pos = computeExpectedPosition({ isPlaying: false, positionAtStart: 42, serverStartedAt: new Date().toISOString() });
  assert.equal(pos, 42);
});
