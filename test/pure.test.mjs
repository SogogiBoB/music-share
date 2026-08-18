import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYoutubeId } from "../js/playlist.js";
import * as player from "../js/player.js";
const { computeExpectedPosition } = player;
import * as auth from "../js/auth.js";
import * as roles from "../js/roles.js";

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

test("DJ가 비어 있을 때만 리스너에게 DJ 되기 권한을 준다", () => {
  assert.equal(typeof roles.canClaimDj, "function");
  assert.equal(roles.canClaimDj({ dj_uid: null }, "listener-uid"), true);
  const activeLease = { dj_uid: "dj-uid", dj_lease_expires_at: "2099-01-01T00:00:00.000Z" };
  assert.equal(roles.canClaimDj(activeLease, "listener-uid"), false);
  assert.equal(roles.canClaimDj(activeLease, "dj-uid"), false);
});

test("만료된 DJ 임대는 리스너가 회수할 수 있다", () => {
  const now = Date.parse("2026-08-19T00:00:30.000Z");
  assert.equal(typeof roles.isDjLeaseExpired, "function");
  assert.equal(roles.isDjLeaseExpired({
    dj_uid: "previous-dj",
    dj_lease_expires_at: "2026-08-19T00:00:00.000Z",
  }, now), true);
  assert.equal(roles.canClaimDj({
    dj_uid: "previous-dj",
    dj_lease_expires_at: "2026-08-19T00:01:00.000Z",
  }, "listener-uid", now), false);
  assert.equal(roles.canClaimDj({
    dj_uid: "previous-dj",
    dj_lease_expires_at: "2026-08-19T00:00:00.000Z",
  }, "listener-uid", now), true);
});

test("DJ를 빼앗긴 기존 DJ에게만 역할 전환 알림을 보낸다", () => {
  assert.equal(typeof roles.shouldNotifyDjTakeover, "function");
  const before = { dj_uid: "previous-dj" };
  const after = { dj_uid: "new-dj" };
  assert.equal(roles.shouldNotifyDjTakeover(before, after, "previous-dj"), true);
  assert.equal(roles.shouldNotifyDjTakeover(before, after, "listener"), false);
  assert.equal(roles.shouldNotifyDjTakeover(before, { dj_uid: "previous-dj" }, "previous-dj"), false);
});

test("재생 상태에 맞춰 중앙 제어 버튼의 아이콘과 레이블을 만든다", () => {
  assert.equal(typeof player.getPlaybackTogglePresentation, "function");
  assert.deepEqual(player.getPlaybackTogglePresentation(true), {
    icon: "Ⅱ",
    label: "일시정지",
  });
  assert.deepEqual(player.getPlaybackTogglePresentation(false), {
    icon: "▶",
    label: "재생",
  });
});
