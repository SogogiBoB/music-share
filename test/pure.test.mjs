import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYoutubeId } from "../js/playlist.js";
import * as player from "../js/player.js";
const { computeExpectedPosition } = player;
import * as auth from "../js/auth.js";

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

test("닉네임 입력은 공백을 거부하고 앞뒤 공백을 제거", () => {
  assert.equal(typeof auth.validateNickname, "function");
  assert.deepEqual(auth.validateNickname("   "), {
    value: "",
    message: "닉네임을 입력해 주세요.",
  });
  assert.deepEqual(auth.validateNickname("  핑크 DJ  "), {
    value: "핑크 DJ",
    message: "",
  });
});

test("저장된 닉네임이 있으면 닉네임 모달을 숨김", () => {
  assert.equal(typeof auth.setNicknameModalVisibility, "function");
  const classes = new Set(["modal"]);
  const modal = {
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
  };

  auth.setNicknameModalVisibility(modal, false);
  assert.equal(classes.has("hidden"), true);

  auth.setNicknameModalVisibility(modal, true);
  assert.equal(classes.has("hidden"), false);
});

test("YouTube API가 이미 준비된 경우에도 플레이어를 즉시 생성", () => {
  assert.equal(typeof player.initializeYouTubePlayer, "function");
  const readyPlayer = { marker: "ready" };
  const calls = [];
  class FakePlayer {
    constructor(elementId, options) {
      calls.push({ elementId, options });
      options.events.onReady({ target: readyPlayer });
    }
  }

  const created = player.initializeYouTubePlayer({
    YT: { Player: FakePlayer },
    onReady: (instance) => calls.push({ instance }),
  });

  assert.equal(created, true);
  assert.equal(calls[0].elementId, "youtube-player");
  assert.equal(calls[1].instance, readyPlayer);
});

test("YouTube API가 로딩 중이면 YT.ready 신호에서 플레이어 초기화를 예약", () => {
  assert.equal(typeof player.whenYouTubeApiAvailable, "function");
  let readyCallback;
  let initialized = 0;
  const registered = player.whenYouTubeApiAvailable({
    YT: { ready: (callback) => { readyCallback = callback; } },
    onAvailable: () => { initialized += 1; },
  });

  assert.equal(registered, true);
  assert.equal(initialized, 0);
  readyCallback();
  assert.equal(initialized, 1);
});
