import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYoutubeId } from "../js/playlist.js";
import * as player from "../js/player.js";
const { computeExpectedPosition } = player;
import * as auth from "../js/auth.js";
import * as roles from "../js/roles.js";
import { hasDuplicateTrack, computeReorderedPositions, filterPlaylistsByQuery } from "../js/playlists.js";
import { parseYoutubeSearchResults } from "../js/youtubeSearch.js";

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

test("nowMs를 넘기면 로컬 시계 대신 보정된 시각으로 계산", () => {
  const serverStartedAt = new Date(0).toISOString();
  const pos = computeExpectedPosition({
    isPlaying: true,
    positionAtStart: 0,
    serverStartedAt,
    nowMs: 5000,
  });
  assert.equal(pos, 5);
});

test("일시정지 상태면 positionAtStart 그대로", () => {
  const pos = computeExpectedPosition({ isPlaying: false, positionAtStart: 42, serverStartedAt: new Date().toISOString() });
  assert.equal(pos, 42);
});

test("초를 mm:ss 로 표시한다", () => {
  assert.equal(player.formatClock(0), "00:00");
  assert.equal(player.formatClock(72), "01:12");
  assert.equal(player.formatClock(281), "04:41");
});

test("음수나 NaN 은 00:00 으로 떨어진다", () => {
  assert.equal(player.formatClock(-3), "00:00");
  assert.equal(player.formatClock(Number.NaN), "00:00");
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

test("이메일 형식 검증", () => {
  assert.equal(typeof auth.validateEmail, "function");
  assert.deepEqual(auth.validateEmail(""), { value: "", message: "이메일을 입력해 주세요." });
  assert.deepEqual(auth.validateEmail("not-an-email"), { value: "not-an-email", message: "올바른 이메일 형식이 아니에요." });
  assert.deepEqual(auth.validateEmail(" user@example.com "), { value: "user@example.com", message: "" });
});

test("비밀번호는 6자 이상", () => {
  assert.equal(typeof auth.validatePassword, "function");
  assert.deepEqual(auth.validatePassword(""), { value: "", message: "비밀번호를 입력해 주세요." });
  assert.deepEqual(auth.validatePassword("abc12"), { value: "abc12", message: "비밀번호는 6자 이상이어야 해요." });
  assert.deepEqual(auth.validatePassword("abc123"), { value: "abc123", message: "" });
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

test("DJ 권한을 얻으면 새로고침 없이 DJ UI 상태로 전환할 수 있다", () => {
  assert.equal(typeof roles.getDjRoleViewState, "function");
  assert.deepEqual(roles.getDjRoleViewState({ dj_uid: "other-dj" }, "me"), {
    amDj: false,
    showClaimButton: true,
  });
  assert.deepEqual(roles.getDjRoleViewState({ dj_uid: "me" }, "me"), {
    amDj: true,
    showClaimButton: false,
  });
});

test("재생목록에 같은 유튜브 곡이 있으면 중복으로 판단", () => {
  const tracks = [{ youtube_id: "abc" }, { youtube_id: "def" }];
  assert.equal(hasDuplicateTrack(tracks, "abc"), true);
  assert.equal(hasDuplicateTrack(tracks, "xyz"), false);
});

test("드래그로 곡 순서를 옮기면 position이 다시 매겨짐", () => {
  const tracks = [
    { id: 1, position: 0 },
    { id: 2, position: 1 },
    { id: 3, position: 2 },
  ];
  const result = computeReorderedPositions(tracks, 0, 2);
  assert.deepEqual(result.map((t) => t.id), [2, 3, 1]);
  assert.deepEqual(result.map((t) => t.position), [0, 1, 2]);
});

test("검색어에 맞는 곡이 있는 재생목록만 남김 (대소문자 무시)", () => {
  const playlists = [
    { id: 1, tracks: [{ title: "Pink Sweat$ - Honesty" }] },
    { id: 2, tracks: [{ title: "IU - Blueming" }] },
    { id: 3, tracks: [] },
  ];
  const result = filterPlaylistsByQuery(playlists, "honesty");
  assert.deepEqual(result.map((p) => p.id), [1]);
  assert.deepEqual(filterPlaylistsByQuery(playlists, ""), playlists);
});

test("유튜브 검색 API 응답에서 videoId/title만 추출", () => {
  const apiJson = {
    items: [
      { id: { videoId: "abc123" }, snippet: { title: "곡 A" } },
      { id: { kind: "youtube#channel" }, snippet: { title: "채널" } },
      { id: { videoId: "def456" }, snippet: { title: "곡 B" } },
    ],
  };
  assert.deepEqual(parseYoutubeSearchResults(apiJson), [
    { videoId: "abc123", title: "곡 A" },
    { videoId: "def456", title: "곡 B" },
  ]);
  assert.deepEqual(parseYoutubeSearchResults({}), []);
});

test("게스트 입장은 닉네임이 비면 막힌다", () => {
  assert.equal(auth.validateNickname("  ").message, "닉네임을 입력해 주세요.");
});

test("게스트 입장은 닉네임만 있으면 통과한다", () => {
  const result = auth.validateNickname("  하람 ");
  assert.equal(result.value, "하람");
  assert.equal(result.message, "");
});

test("DJ는 대기열·트랜스포트·라이브러리 탭을 모두 본다", () => {
  const view = roles.getRoomViewState({ settingsRow: { dj_uid: "u1" }, uid: "u1", isGuest: false });
  assert.deepEqual(view, {
    amDj: true, isGuest: false, showClaimButton: false,
    showQueuePanel: true, showTransport: true, showLibraryTab: true, canDelegate: true,
  });
});

test("회원 리스너는 대기열·트랜스포트를 못 보지만 DJ 되기와 라이브러리는 본다", () => {
  const view = roles.getRoomViewState({ settingsRow: { dj_uid: "u1" }, uid: "u2", isGuest: false });
  assert.equal(view.showQueuePanel, false);
  assert.equal(view.showTransport, false);
  assert.equal(view.showClaimButton, true);
  assert.equal(view.showLibraryTab, true);
});

test("게스트는 DJ 되기 버튼도 라이브러리 탭도 못 본다", () => {
  const view = roles.getRoomViewState({ settingsRow: { dj_uid: "u1" }, uid: "u3", isGuest: true });
  assert.equal(view.showClaimButton, false);
  assert.equal(view.showLibraryTab, false);
  assert.equal(view.canDelegate, false);
});

test("게스트는 DJ가 비어 있어도 DJ 되기 버튼을 못 본다", () => {
  const view = roles.getRoomViewState({ settingsRow: { dj_uid: null }, uid: "u3", isGuest: true });
  assert.equal(view.showClaimButton, false);
});

test("게스트에게는 DJ를 위임할 수 없다", () => {
  assert.equal(roles.canDelegateTo({ uid: "u3", is_guest: true }), false);
  assert.equal(roles.canDelegateTo({ uid: "u2", is_guest: false }), true);
});

import { computeOutputVolume, clampVolume } from "../js/volume.js";

test("실제 출력은 마스터와 내 볼륨의 곱이다", () => {
  assert.equal(computeOutputVolume({ master: 85, mine: 80 }), 68);
});

test("마스터가 음소거면 출력은 0", () => {
  assert.equal(computeOutputVolume({ master: 85, mine: 80, masterMuted: true }), 0);
});

test("내가 음소거면 출력은 0", () => {
  assert.equal(computeOutputVolume({ master: 85, mine: 80, myMuted: true }), 0);
});

test("출력은 정수로 반올림된다", () => {
  assert.equal(computeOutputVolume({ master: 33, mine: 33 }), 11);
});

test("볼륨은 0~100 으로 잘린다", () => {
  assert.equal(clampVolume(-5), 0);
  assert.equal(clampVolume(140), 100);
  assert.equal(clampVolume(62.7), 63);
});

import { partitionLibraryTracks } from "../js/playlists.js";

test("이미 대기열에 있는 곡과 아직 없는 곡을 나눈다", () => {
  const library = [
    { youtube_id: "a", title: "A" },
    { youtube_id: "b", title: "B" },
    { youtube_id: "c", title: "C" },
  ];
  const queue = [{ youtube_id: "b", title: "B" }];
  const { addable, already } = partitionLibraryTracks(library, queue);
  assert.deepEqual(addable.map((t) => t.youtube_id), ["a", "c"]);
  assert.deepEqual(already.map((t) => t.youtube_id), ["b"]);
});

test("대기열이 비어 있으면 전부 담을 수 있다", () => {
  const library = [{ youtube_id: "a", title: "A" }];
  assert.equal(partitionLibraryTracks(library, []).addable.length, 1);
  assert.equal(partitionLibraryTracks(library, []).already.length, 0);
});

test("빈 재생목록이면 양쪽 다 비어 있다", () => {
  const { addable, already } = partitionLibraryTracks([], [{ youtube_id: "a", title: "A" }]);
  assert.deepEqual(addable, []);
  assert.deepEqual(already, []);
});

test("5초 이상 재생 중 이전 버튼을 누르면 현재 곡의 처음(0초)으로 리셋", () => {
  const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const action = player.computePrevTrackAction({
    tracks,
    currentTrackId: 2,
    currentPosition: 5.2,
    isPlaying: true,
  });
  assert.deepEqual(action, {
    action: "restart",
    trackId: 2,
    position: 0,
    isPlaying: true,
  });
});

test("5초 이상 일시정지 상태에서 이전 버튼을 누르면 일시정지 상태로 0초 리셋", () => {
  const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const action = player.computePrevTrackAction({
    tracks,
    currentTrackId: 2,
    currentPosition: 12.0,
    isPlaying: false,
  });
  assert.deepEqual(action, {
    action: "restart",
    trackId: 2,
    position: 0,
    isPlaying: false,
  });
});

test("5초 미만 재생 중 이전 버튼을 누르면 이전 곡의 0초로 이동", () => {
  const tracks = [{ id: 10 }, { id: 20 }, { id: 30 }];
  const action = player.computePrevTrackAction({
    tracks,
    currentTrackId: 20,
    currentPosition: 3.4,
    isPlaying: true,
  });
  assert.deepEqual(action, {
    action: "prev_track",
    trackId: 10,
    position: 0,
    isPlaying: true,
  });
});

test("첫 번째 곡이고 5초 미만일 때 이전 버튼을 누르면 0초로 리셋", () => {
  const tracks = [{ id: 10 }, { id: 20 }];
  const action = player.computePrevTrackAction({
    tracks,
    currentTrackId: 10,
    currentPosition: 2.1,
    isPlaying: true,
  });
  assert.deepEqual(action, {
    action: "restart",
    trackId: 10,
    position: 0,
    isPlaying: true,
  });
});

test("재생목록에 없는 곡이면 action이 none", () => {
  const tracks = [{ id: 10 }];
  const action = player.computePrevTrackAction({
    tracks,
    currentTrackId: 999,
    currentPosition: 1.0,
    isPlaying: true,
  });
  assert.deepEqual(action, { action: "none" });
});


