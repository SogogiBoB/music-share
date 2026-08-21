import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYoutubeId } from "../js/playlist.js";
import * as player from "../js/player.js";
const { computeExpectedPosition } = player;
import * as auth from "../js/auth.js";
import * as roles from "../js/roles.js";
import { hasDuplicateTrack, computeReorderedPositions, filterPlaylistsByQuery } from "../js/playlists.js";
import * as playlists from "../js/playlists.js";
import { parseYoutubeSearchResults } from "../js/youtubeSearch.js";
import * as rooms from "../js/rooms.js";

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

test("한곡 반복 모드(one)에서는 곡 종료 시 같은 곡 0초 재생", () => {
  const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const next = player.computeNextTrackOnEnded({
    tracks,
    currentTrackId: 2,
    repeatMode: "one",
  });
  assert.deepEqual(next, { action: "play", trackId: 2, position: 0 });
});

test("전체 반복 모드(all)에서 중간 곡 종료 시 다음 곡으로 진행", () => {
  const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const next = player.computeNextTrackOnEnded({
    tracks,
    currentTrackId: 2,
    repeatMode: "all",
  });
  assert.deepEqual(next, { action: "play", trackId: 3, position: 0 });
});

test("전체 반복 모드(all)에서 마지막 곡 종료 시 첫 번째 곡으로 순환", () => {
  const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const next = player.computeNextTrackOnEnded({
    tracks,
    currentTrackId: 3,
    repeatMode: "all",
  });
  assert.deepEqual(next, { action: "play", trackId: 1, position: 0 });
});

test("반복 모드 꺼짐(off)에서 중간 곡 종료 시 다음 곡으로 진행", () => {
  const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const next = player.computeNextTrackOnEnded({
    tracks,
    currentTrackId: 1,
    repeatMode: "off",
  });
  assert.deepEqual(next, { action: "play", trackId: 2, position: 0 });
});

test("반복 모드 꺼짐(off)에서 마지막 곡 종료 시 재생 중지", () => {
  const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const next = player.computeNextTrackOnEnded({
    tracks,
    currentTrackId: 3,
    repeatMode: "off",
  });
  assert.deepEqual(next, { action: "stop" });
});

test("서버 시각이 로컬 시각보다 미래(시계 오차)여도 음수 경과시간이 발생하지 않고 시작 위치를 유지", () => {
  // 클라이언트 로컬 시각보다 서버 시각이 2초 미래로 찍힌 경우 (음수 elapsed)
  const futureServerStartedAt = new Date(10_000).toISOString();
  const pos = computeExpectedPosition({
    isPlaying: true,
    positionAtStart: 5,
    serverStartedAt: futureServerStartedAt,
    nowMs: 8_000,
  });
  assert.equal(pos, 5);
});

test("serverStartedAt 이 유효하지 않거나 비어 있어도 NaN이 되지 않고 안전하게 시작 위치를 반환", () => {
  assert.equal(computeExpectedPosition({ isPlaying: true, positionAtStart: 12, serverStartedAt: null }), 12);
  assert.equal(computeExpectedPosition({ isPlaying: true, positionAtStart: 12, serverStartedAt: "invalid-date" }), 12);
  assert.equal(computeExpectedPosition({ isPlaying: true, positionAtStart: undefined, serverStartedAt: null }), 0);
});





// ── 곡 길이를 넘어선 재생 위치 방어 ─────────────────────────────
// 재생이 끝난 뒤에도 computeExpectedPosition 은 경과 시간을 계속 더하므로
// position_at_start 에 곡 길이를 넘는 값이 기록될 수 있다. 그 값으로 seek/load 하면
// YouTube 가 즉시 종료 상태로 되돌리고, DJ 의 종료 핸들러가 다시 DB 를 쓰면서
// "몇 초 재생 후 처음으로 되돌아가는" 루프가 만들어진다.
const { clampPositionToDuration, computeSeekTarget } = player;

test("clampPositionToDuration: 곡 길이를 넘는 위치는 곡 끝으로 제한된다", () => {
  assert.equal(clampPositionToDuration(280.1985, 186), 186);
  assert.equal(clampPositionToDuration(100, 186), 100);
});

test("clampPositionToDuration: duration 을 모르면(0/NaN) 위치를 그대로 두되 음수는 0으로", () => {
  assert.equal(clampPositionToDuration(120, 0), 120);
  assert.equal(clampPositionToDuration(120, undefined), 120);
  assert.equal(clampPositionToDuration(-5, 186), 0);
  assert.equal(clampPositionToDuration(Number.NaN, 186), 0);
});

test("computeSeekTarget: 곡이 끝난 지점 이후로는 seek 하지 않는다(null)", () => {
  assert.equal(computeSeekTarget({ expected: 280.1985, duration: 186 }), null);
  assert.equal(computeSeekTarget({ expected: 186, duration: 186 }), null);
});

test("computeSeekTarget: 곡 안쪽 지점은 그대로 seek 대상이 된다", () => {
  assert.equal(computeSeekTarget({ expected: 90, duration: 186 }), 90);
  assert.equal(computeSeekTarget({ expected: 0, duration: 186 }), 0);
});

test("computeSeekTarget: duration 을 아직 모르면 expected 를 그대로 사용한다", () => {
  assert.equal(computeSeekTarget({ expected: 42, duration: 0 }), 42);
  assert.equal(computeSeekTarget({ expected: 42, duration: undefined }), 42);
  assert.equal(computeSeekTarget({ expected: -3, duration: 186 }), 0);
});

// ── 프로필 닉네임 결정 ─────────────────────────────────────────
// ensureIdentity 가 매 로드마다 "게스트" 를 기본값으로 프로필에 덮어써서
// 정회원까지 전원 게스트로 표시되던 문제를 막는다.
const { deriveNickname } = auth;

test("deriveNickname: 저장된 닉네임이 있으면 그대로 쓴다", () => {
  assert.equal(deriveNickname({ storedNickname: "설탕", isAnonymous: false }), "설탕");
  assert.equal(deriveNickname({ storedNickname: "  설탕  " }), "설탕");
});

test("deriveNickname: 익명(게스트) 세션은 게스트로 표시한다", () => {
  assert.equal(deriveNickname({ isAnonymous: true }), "게스트");
  assert.equal(deriveNickname({ storedNickname: "게스트", isAnonymous: true }), "게스트");
  assert.equal(deriveNickname({ storedNickname: "밤손님", isAnonymous: true }), "밤손님");
});

test("deriveNickname: 정회원인데 닉네임이 게스트 자리표시자면 리스너로 되돌린다", () => {
  assert.equal(deriveNickname({ storedNickname: "게스트", isAnonymous: false }), "리스너");
});

test("deriveNickname: 이메일은 절대 닉네임으로 쓰지 않는다", () => {
  assert.equal(deriveNickname({ email: "sugar@dj.kr", isAnonymous: false }), "리스너");
  assert.equal(deriveNickname({ email: "sugar@dj.kr", isAnonymous: true }), "게스트");
  assert.equal(deriveNickname({}), "리스너");
});

// ── 재생목록 셀렉트 동기화 ────────────────────────────────────
// 방 화면의 "내 재생목록에서 대기열로" 셀렉트는 개수만 비교해서 다시 그렸기 때문에
// 다른 탭에서 만든 재생목록이 화면에 나타나지 않았다.
const { playlistOptionsChanged } = playlists;

test("playlistOptionsChanged: 개수가 같아도 id 나 이름이 다르면 다시 그린다", () => {
  assert.equal(playlistOptionsChanged([{ value: "1", label: "밤" }], [{ id: 1, name: "밤" }]), false);
  assert.equal(playlistOptionsChanged([{ value: "1", label: "밤" }], [{ id: 2, name: "밤" }]), true);
  assert.equal(playlistOptionsChanged([{ value: "1", label: "밤" }], [{ id: 1, name: "낮" }]), true);
});

test("playlistOptionsChanged: 개수가 다르면 다시 그린다", () => {
  assert.equal(playlistOptionsChanged([], [{ id: 1, name: "밤" }]), true);
  assert.equal(playlistOptionsChanged([{ value: "1", label: "밤" }], []), true);
});

// ── 링크/키워드 통합 검색 ──────────────────────────────────────
// 입력창 하나로 링크와 키워드를 모두 받는다. 링크면 그 곡 하나를 결과로,
// 키워드면 유튜브 검색 결과를 보여주고 그중 하나를 골라 추가한다.
import { classifySearchInput, searchUnified } from "../js/youtubeSearch.js";

test("classifySearchInput: 빈 입력", () => {
  assert.deepEqual(classifySearchInput(""), { kind: "empty" });
  assert.deepEqual(classifySearchInput("   "), { kind: "empty" });
  assert.deepEqual(classifySearchInput(null), { kind: "empty" });
});

test("classifySearchInput: 유튜브 링크는 videoId 로 분류", () => {
  assert.deepEqual(classifySearchInput("https://youtu.be/dQw4w9WgXcQ"),
    { kind: "url", videoId: "dQw4w9WgXcQ" });
  assert.deepEqual(classifySearchInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s"),
    { kind: "url", videoId: "dQw4w9WgXcQ" });
  assert.deepEqual(classifySearchInput("  https://m.youtube.com/watch?v=dQw4w9WgXcQ  "),
    { kind: "url", videoId: "dQw4w9WgXcQ" });
  assert.deepEqual(classifySearchInput("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    { kind: "url", videoId: "dQw4w9WgXcQ" });
});

test("classifySearchInput: 11자 영상 id 를 그대로 붙여넣어도 링크로 본다", () => {
  assert.deepEqual(classifySearchInput("dQw4w9WgXcQ"), { kind: "url", videoId: "dQw4w9WgXcQ" });
});

test("classifySearchInput: 그 밖의 입력은 키워드", () => {
  assert.deepEqual(classifySearchInput("aespa lemonade"), { kind: "keyword", query: "aespa lemonade" });
  assert.deepEqual(classifySearchInput("  뉴진스 하입보이 "), { kind: "keyword", query: "뉴진스 하입보이" });
  // 유튜브 링크처럼 보이지만 videoId 가 없는 주소는 키워드로 흘려보내지 않고 오류로 알린다
  assert.deepEqual(classifySearchInput("https://www.youtube.com/results?search_query=x"),
    { kind: "invalid-url" });
});

test("searchUnified: 링크 입력이면 그 곡 하나만 결과로 준다", async () => {
  const results = await searchUnified({
    input: "https://youtu.be/dQw4w9WgXcQ",
    searchByKeyword: async () => { throw new Error("키워드 검색이 호출되면 안 된다"); },
    fetchTitleById: async (id) => `제목:${id}`,
  });
  assert.deepEqual(results, [{ videoId: "dQw4w9WgXcQ", title: "제목:dQw4w9WgXcQ" }]);
});

test("searchUnified: 키워드 입력이면 검색 결과 목록을 준다", async () => {
  const results = await searchUnified({
    input: "aespa lemonade",
    searchByKeyword: async (q) => [{ videoId: "a1", title: `${q} 1` }, { videoId: "b2", title: `${q} 2` }],
    fetchTitleById: async () => { throw new Error("링크 조회가 호출되면 안 된다"); },
  });
  assert.deepEqual(results, [{ videoId: "a1", title: "aespa lemonade 1" }, { videoId: "b2", title: "aespa lemonade 2" }]);
});

test("searchUnified: 빈 입력은 빈 결과, 잘못된 유튜브 주소는 오류", async () => {
  assert.deepEqual(await searchUnified({ input: "  ", searchByKeyword: async () => [], fetchTitleById: async () => "" }), []);
  await assert.rejects(
    () => searchUnified({ input: "https://www.youtube.com/results?search_query=x", searchByKeyword: async () => [], fetchTitleById: async () => "" }),
    /유튜브 링크/
  );
});

test("parseYoutubeId: shorts·embed·music 주소도 인식", () => {
  assert.equal(parseYoutubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYoutubeId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYoutubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYoutubeId("https://www.youtube.com/results?search_query=x"), null);
});

// ── 대기열 곡을 내 재생목록으로 저장 ──────────────────────────
// 대기열 위의 "내 재생목록에도 저장" 체크박스를 없애고, 곡마다 [플리로] 버튼으로
// 저장 대상 재생목록을 고르게 바꾼다. 게스트는 재생목록 자체가 없으므로 숨긴다.
const { getSaveToPlaylistState } = playlists;

test("getSaveToPlaylistState: 게스트에게는 버튼을 보여주지 않는다", () => {
  assert.deepEqual(getSaveToPlaylistState({ isGuest: true, playlists: [{ id: 1, name: "밤" }] }),
    { showButton: false, canSave: false, message: "" });
});

test("getSaveToPlaylistState: 재생목록이 없으면 버튼은 보이되 저장은 막고 안내한다", () => {
  assert.deepEqual(getSaveToPlaylistState({ isGuest: false, playlists: [] }),
    { showButton: true, canSave: false, message: "내 재생목록을 먼저 만들어 주세요." });
});

test("getSaveToPlaylistState: 재생목록이 있으면 저장 가능", () => {
  assert.deepEqual(getSaveToPlaylistState({ isGuest: false, playlists: [{ id: 1, name: "밤" }] }),
    { showButton: true, canSave: true, message: "" });
});

// ── 곡 제목 HTML 엔티티 디코딩 ────────────────────────────────
// 유튜브 검색 API 는 snippet.title 을 HTML 이스케이프해서 준다. 화면은 textContent 로
// 그리므로 엔티티가 문자 그대로 보인다. 데이터 경계에서 풀어 준다.
import { decodeHtmlEntities, normalizeTitle, normalizeTrackTitles } from "../js/titleText.js";

test("decodeHtmlEntities: 이름 있는 엔티티를 푼다", () => {
  assert.equal(decodeHtmlEntities("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(decodeHtmlEntities("Don&#39;t Stop"), "Don't Stop");
  assert.equal(decodeHtmlEntities("&quot;Hello&quot;"), '"Hello"');
  assert.equal(decodeHtmlEntities("a &lt;b&gt; c"), "a <b> c");
  assert.equal(decodeHtmlEntities("Don&apos;t"), "Don't");
});

test("decodeHtmlEntities: 10진·16진 숫자 참조를 푼다", () => {
  assert.equal(decodeHtmlEntities("&#48124;"), "민");
  assert.equal(decodeHtmlEntities("&#x1F3B5;"), "\u{1F3B5}");
  assert.equal(decodeHtmlEntities("&#X41;"), "A");
});

test("decodeHtmlEntities: 이중 이스케이프도 끝까지 푼다", () => {
  assert.equal(decodeHtmlEntities("Don&amp;#39;t Stop"), "Don't Stop");
});

test("decodeHtmlEntities: 모르는 엔티티와 맨 & 는 그대로 둔다", () => {
  assert.equal(decodeHtmlEntities("R&B &foo; 100&"), "R&B &foo; 100&");
});

test("decodeHtmlEntities: 빈 값은 빈 문자열", () => {
  assert.equal(decodeHtmlEntities(null), "");
  assert.equal(decodeHtmlEntities(undefined), "");
});

test("normalizeTitle: 디코딩 후 양끝 공백을 정리한다", () => {
  assert.equal(normalizeTitle("  IU &amp; Suga  "), "IU & Suga");
  assert.equal(normalizeTitle("&nbsp;IU&nbsp;"), "IU");
});

test("normalizeTrackTitles: 목록의 모든 곡 제목을 푼다", () => {
  assert.deepEqual(
    normalizeTrackTitles([
      { id: 1, youtube_id: "a", title: "Tom &amp; Jerry" },
      { id: 2, youtube_id: "b", title: "Don&#39;t Stop" },
    ]),
    [
      { id: 1, youtube_id: "a", title: "Tom & Jerry" },
      { id: 2, youtube_id: "b", title: "Don't Stop" },
    ]
  );
  assert.deepEqual(normalizeTrackTitles(null), null);
});

test("parseYoutubeSearchResults: 검색 결과 제목의 엔티티를 풀어서 준다", () => {
  const apiJson = {
    items: [{ id: { videoId: "abc123" }, snippet: { title: "Tom &amp; Jerry &#39;OST&#39;" } }],
  };
  assert.deepEqual(parseYoutubeSearchResults(apiJson), [
    { videoId: "abc123", title: "Tom & Jerry 'OST'" },
  ]);
});

// ── 방(room) 구조 ────────────────────────────────────────────
test("방 이름은 공백만 있으면 거부하고 앞뒤 공백을 제거한다", () => {
  assert.equal(rooms.validateRoomName("   ").message !== "", true);
  assert.deepEqual(rooms.validateRoomName("  재즈의 밤  ").value, "재즈의 밤");
  assert.equal(rooms.validateRoomName("재즈의 밤").message, "");
});

test("방 이름은 30자를 넘기면 거부한다", () => {
  assert.equal(rooms.validateRoomName("가".repeat(30)).message, "");
  assert.notEqual(rooms.validateRoomName("가".repeat(31)).message, "");
});

test("방 비밀번호는 선택 사항이라 비어 있어도 통과하고 null 로 정규화된다", () => {
  assert.deepEqual(rooms.normalizeRoomPassword(""), null);
  assert.deepEqual(rooms.normalizeRoomPassword("   "), null);
  assert.deepEqual(rooms.normalizeRoomPassword(undefined), null);
  assert.deepEqual(rooms.normalizeRoomPassword("hunter2"), "hunter2");
});

test("게스트에게는 방 만들기 버튼을 감춘다", () => {
  assert.equal(rooms.getRoomListViewState({ isGuest: false }).showCreateButton, true);
  assert.equal(rooms.getRoomListViewState({ isGuest: true }).showCreateButton, false);
});

test("방 삭제 버튼은 내가 만든 방에만 보인다", () => {
  assert.equal(rooms.canDeleteRoom({ owner_uid: "u1" }, "u1"), true);
  assert.equal(rooms.canDeleteRoom({ owner_uid: "u1" }, "u2"), false);
  assert.equal(rooms.canDeleteRoom(null, "u1"), false);
});

test("URL 해시에서 방 id 를 읽는다", () => {
  assert.equal(rooms.parseRoomId({ hash: "#room=12" }), 12);
  assert.equal(rooms.parseRoomId({ hash: "#room=abc" }), null);
  assert.equal(rooms.parseRoomId({ hash: "" }), null);
  assert.equal(rooms.parseRoomId({ hash: "#other=1" }), null);
});

// `npx serve` 같은 clean-URL 서버는 /index.html?room=1 을 /index 로 301 하면서
// 쿼리스트링을 버린다. 해시는 서버로 가지 않아 살아남으므로 해시를 정본으로 쓰되,
// 예전 형태의 링크도 계속 열리게 쿼리도 함께 읽는다.
test("쿼리 형태 링크도 계속 읽고, 해시가 우선한다", () => {
  assert.equal(rooms.parseRoomId({ search: "?room=7" }), 7);
  assert.equal(rooms.parseRoomId({ search: "?room=7", hash: "#room=12" }), 12);
  assert.equal(rooms.parseRoomId({}), null);
});

test("방 목록 한 줄에 방장 닉네임과 인원수를 함께 보여준다", () => {
  assert.equal(
    rooms.formatRoomMeta({ owner_nickname: "슈가", member_count: 3 }),
    "방장 슈가 · 3명",
  );
  assert.equal(
    rooms.formatRoomMeta({ owner_nickname: null, member_count: 0 }),
    "방장 알 수 없음 · 0명",
  );
});

test("방 화면 권한은 방장 여부로만 갈린다 (DJ 되기 없음)", () => {
  const owner = roles.getRoomViewState({ room: { owner_uid: "u1" }, uid: "u1", isGuest: false });
  assert.equal(owner.amDj, true);
  assert.equal(owner.showQueuePanel, true);
  assert.equal(owner.showTransport, true);
  assert.equal(owner.showLibraryTab, true);

  const listener = roles.getRoomViewState({ room: { owner_uid: "u1" }, uid: "u2", isGuest: false });
  assert.equal(listener.amDj, false);
  assert.equal(listener.showQueuePanel, false);
  assert.equal(listener.showTransport, false);
  assert.equal(listener.showLibraryTab, true);

  const guest = roles.getRoomViewState({ room: { owner_uid: "u1" }, uid: "u3", isGuest: true });
  assert.equal(guest.amDj, false);
  assert.equal(guest.showLibraryTab, false);
});

test("방 안내 문구는 방장 여부와 게스트 여부에 따라 달라진다", () => {
  assert.match(roles.getRoomStatusText({ amDj: true, isGuest: false }), /방장/);
  assert.match(roles.getRoomStatusText({ amDj: false, isGuest: true }), /게스트/);
  assert.match(roles.getRoomStatusText({ amDj: false, isGuest: false }), /방장/);
});

// ── 반복 재생 시 자동 재시작 ──────────────────────────────────
// 한곡 반복(또는 트랙 1개짜리 전체 반복)에서 곡이 끝나면 DJ 는 같은 트랙을
// position_at_start=0 으로 다시 쓴다. 이때 old/new 의 current_track_id·is_playing·
// position_at_start 가 전부 같아서 DB 트리거가 server_started_at 을 재각인하지 않으면
// expected 위치가 곡 길이를 넘어버리고, computeSeekTarget 이 null 을 돌려주면서
// 아무도 0초로 되감지 않아 재생이 재개되지 않는다.
const { buildSetTrackUpdate, shouldSeekToTarget } = player;

test("buildSetTrackUpdate: 같은 트랙을 다시 시작해도 restart_token 이 매번 달라진다", () => {
  const first = buildSetTrackUpdate(7);
  const second = buildSetTrackUpdate(7);

  assert.equal(first.current_track_id, 7);
  assert.equal(first.is_playing, true);
  assert.equal(first.position_at_start, 0);
  assert.ok(first.restart_token);
  assert.notEqual(first.restart_token, second.restart_token);
});

test("shouldSeekToTarget: 곡이 끝난(ENDED) 플레이어도 0초로 되감아야 한다", () => {
  assert.equal(shouldSeekToTarget({
    target: 0, actual: 186, playerState: 0, timeSinceLoadMs: 190_000,
  }), true);
});

test("shouldSeekToTarget: seek 대상이 없거나(null) 오차가 작으면 되감지 않는다", () => {
  assert.equal(shouldSeekToTarget({
    target: null, actual: 186, playerState: 0, timeSinceLoadMs: 190_000,
  }), false);
  assert.equal(shouldSeekToTarget({
    target: 90, actual: 90.4, playerState: 1, timeSinceLoadMs: 190_000,
  }), false);
});

test("shouldSeekToTarget: 로드 직후 3.5초 이내에는 버퍼링 중이므로 되감지 않는다", () => {
  assert.equal(shouldSeekToTarget({
    target: 90, actual: 2, playerState: 1, timeSinceLoadMs: 1_000,
  }), false);
});

test("shouldSeekToTarget: 버퍼링/미시작(CUED) 상태에서는 되감지 않는다", () => {
  assert.equal(shouldSeekToTarget({
    target: 90, actual: 0, playerState: 3, timeSinceLoadMs: 190_000,
  }), false);
  assert.equal(shouldSeekToTarget({
    target: 90, actual: 0, playerState: 5, timeSinceLoadMs: 190_000,
  }), false);
});

test("한곡 반복: server_started_at 이 재각인되면 되감기 대상이 0초로 나온다", () => {
  const duration = 186;
  const restartedAt = "2026-08-22T01:00:00.000Z";
  const nowAtRestart = new Date(restartedAt).getTime() + 200;

  const expected = player.computeExpectedPosition({
    isPlaying: true,
    positionAtStart: 0,
    serverStartedAt: restartedAt,
    nowMs: nowAtRestart,
  });
  const target = computeSeekTarget({ expected, duration });

  assert.ok(target !== null && target < 1);
  assert.equal(shouldSeekToTarget({
    target, actual: duration, playerState: 0, timeSinceLoadMs: duration * 1000,
  }), true);
});
