export function computeExpectedPosition({ isPlaying, positionAtStart, serverStartedAt, nowMs = Date.now() }) {
  const basePosition = Number(positionAtStart) || 0;
  if (!isPlaying) return Math.max(0, basePosition);
  if (!serverStartedAt) return Math.max(0, basePosition);

  const serverStartedMs = new Date(serverStartedAt).getTime();
  if (!Number.isFinite(serverStartedMs)) return Math.max(0, basePosition);

  // 시계 오차 등으로 인해 nowMs 가 serverStartedMs 보다 작더라도(미래 시각),
  // 음수 경과 시간이 발생하여 0초로 리셋되는 현상을 방지한다.
  const elapsedSec = Math.max(0, (nowMs - serverStartedMs) / 1000);
  return basePosition + elapsedSec;
}

// 재생이 끝난 뒤에도 computeExpectedPosition 은 경과 시간을 계속 더한다.
// 그 값을 그대로 position_at_start 로 기록하면 곡 길이를 넘는 시작 위치가 DB 에 남고,
// 이후 모든 재생이 곡 끝 너머로 seek 되어 곧바로 종료 상태가 된다.
export function clampPositionToDuration(position, duration) {
  const pos = Number(position);
  if (!Number.isFinite(pos) || pos < 0) return 0;
  const dur = Number(duration);
  if (!Number.isFinite(dur) || dur <= 0) return pos;
  return Math.min(pos, dur);
}

// 곡 끝(또는 그 너머)으로의 seek 은 YouTube 가 즉시 ENDED 로 응답한다.
// DJ 의 ENDED 핸들러가 그때마다 playback_state 를 다시 쓰고, 그 변경이 realtime 으로
// 되돌아와 또 seek 하는 루프가 되므로 "끝난 지점"은 seek 대상에서 제외한다(null).
export function computeSeekTarget({ expected, duration }) {
  const pos = Number(expected);
  if (!Number.isFinite(pos) || pos < 0) return 0;
  const dur = Number(duration);
  if (!Number.isFinite(dur) || dur <= 0) return pos;
  if (pos >= dur - 0.5) return null;
  return pos;
}

// 곡이 끝난(ENDED) 플레이어도 되감기 대상이다. 한곡 반복은 영상을 다시 로드하지 않고
// 같은 영상을 0초로 되감아 재생하므로, ENDED 를 제외하면 반복 재생이 재개되지 않는다.
// BUFFERING(3)·CUED(5) 는 아직 위치가 확정되지 않은 단계라 되감지 않는다.
const SEEKABLE_PLAYER_STATES = new Set([0, 1, 2]); // ENDED, PLAYING, PAUSED

export function shouldSeekToTarget({ target, actual, playerState, timeSinceLoadMs }) {
  if (target === null || target === undefined) return false;
  if (!SEEKABLE_PLAYER_STATES.has(playerState)) return false;
  // 로드 직후에는 버퍼링 중일 수 있어 불필요한 seek 이 재생을 되감아버린다.
  if (!(timeSinceLoadMs > 3500)) return false;
  return Math.abs(Number(target) - Number(actual)) > 1.5;
}

// 같은 트랙을 같은 위치(0초)로 다시 시작하면 UPDATE 전후 값이 완전히 같아진다.
// 그러면 DB 트리거 stamp_server_started_at 이 "값이 안 바뀐 UPDATE" 로 보고
// server_started_at 을 재각인하지 않아, 모든 클라이언트가 이미 곡이 끝난 시각을
// 기준으로 위치를 계산하게 된다(= 반복 재생이 재개되지 않는다).
// 매번 달라지는 restart_token 을 실어 "의도된 재시작"임을 DB 에 알린다.
export function generateRestartToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildSetTrackUpdate(trackId, { token = generateRestartToken() } = {}) {
  return {
    current_track_id: trackId,
    is_playing: true,
    position_at_start: 0,
    restart_token: token,
  };
}

export function formatClock(seconds) {
  const total = Math.floor(Number(seconds));
  if (!Number.isFinite(total) || total < 0) return "00:00";
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function getPlaybackTogglePresentation(isPlaying) {
  return isPlaying
    ? { icon: "Ⅱ", label: "일시정지" }
    : { icon: "▶", label: "재생" };
}

export function computePrevTrackAction({
  tracks = [],
  currentTrackId,
  currentPosition = 0,
  isPlaying = false,
  thresholdSec = 5,
}) {
  const currentIndex = tracks.findIndex((t) => t.id === currentTrackId);
  if (currentIndex === -1) {
    return { action: "none" };
  }

  // 5초 이상 재생했으면 현재 곡의 처음으로 리셋
  if (currentPosition >= thresholdSec) {
    return {
      action: "restart",
      trackId: currentTrackId,
      position: 0,
      isPlaying,
    };
  }

  // 5초 미만이고 이전 곡이 있으면 이전 곡으로 이동
  if (currentIndex > 0) {
    return {
      action: "prev_track",
      trackId: tracks[currentIndex - 1].id,
      position: 0,
      isPlaying: true,
    };
  }

  // 5초 미만이지만 첫 번째 곡이면 현재 곡 처음으로 리셋
  return {
    action: "restart",
    trackId: currentTrackId,
    position: 0,
    isPlaying,
  };
}

export function computeNextTrackOnEnded({
  tracks = [],
  currentTrackId,
  repeatMode = "off",
}) {
  const currentIndex = tracks.findIndex((t) => t.id === currentTrackId);
  if (currentIndex === -1) {
    return { action: "stop" };
  }

  // 한곡 반복
  if (repeatMode === "one") {
    return {
      action: "play",
      trackId: currentTrackId,
      position: 0,
    };
  }

  // 다음 곡이 있는 경우
  if (currentIndex + 1 < tracks.length) {
    return {
      action: "play",
      trackId: tracks[currentIndex + 1].id,
      position: 0,
    };
  }

  // 마지막 곡이고 전체 반복인 경우
  if (repeatMode === "all" && tracks.length > 0) {
    return {
      action: "play",
      trackId: tracks[0].id,
      position: 0,
    };
  }

  return { action: "stop" };
}

import { supabase } from "./supabaseClient.js";

let ytPlayer = typeof window !== "undefined" ? (window.__sugarDjPlayer ?? null) : null;
let lastOutputVolume = 100;
let playerReadyResolve;
let onStateChangeCallback = null;

let playerReady;
if (typeof window !== "undefined" && window.__sugarDjPlayerReady) {
  playerReady = window.__sugarDjPlayerReady;
  playerReadyResolve = window.__sugarDjPlayerReadyResolve;
} else {
  playerReady = new Promise((resolve) => {
    playerReadyResolve = resolve;
  });
  if (typeof window !== "undefined") {
    window.__sugarDjPlayerReady = playerReady;
    window.__sugarDjPlayerReadyResolve = playerReadyResolve;
  }
}

export function setPlayerStateChangeHandler(fn) {
  onStateChangeCallback = fn;
}

export function initializeYouTubePlayer({ YT: youtubeApi, onReady, onStateChange } = {}) {
  const api = youtubeApi ?? (typeof window !== "undefined" ? window.YT : undefined);
  if (!api?.Player || ytPlayer) {
    return false;
  }

  if (onStateChange) {
    onStateChangeCallback = onStateChange;
  }

  let createdPlayer;
  createdPlayer = new api.Player("youtube-player", {
    height: "1",
    width: "1",
    playerVars: {
      playsinline: 1,
      enablejsapi: 1,
      origin: typeof window !== "undefined" && window.location?.origin ? window.location.origin : undefined,
    },
    events: {
      onReady: (event) => {
        ytPlayer = event.target ?? createdPlayer;
        if (typeof window !== "undefined") window.__sugarDjPlayer = ytPlayer;
        playerReadyResolve?.(ytPlayer);
        onReady?.(ytPlayer);
      },
      onStateChange: (event) => {
        onStateChangeCallback?.(event);
      },
    },
  });
  // YouTube API의 onReady는 보통 비동기로 오지만, 테스트/래퍼 구현은 즉시 호출할 수 있다.
  // 즉시 호출된 경우 onReady에서 확정한 인스턴스를 덮어쓰지 않는다.
  if (!ytPlayer) {
    ytPlayer = createdPlayer;
    if (typeof window !== "undefined") window.__sugarDjPlayer = ytPlayer;
  }
  return true;
}

export function whenYouTubeApiAvailable({ YT: youtubeApi, onAvailable } = {}) {
  const api = youtubeApi ?? (typeof window !== "undefined" ? window.YT : undefined);
  if (api?.Player) {
    onAvailable();
    return true;
  }
  if (typeof api?.ready === "function") {
    api.ready(() => {
      onAvailable();
    });
    return true;
  }
  if (typeof window !== "undefined") {
    // API 스크립트가 로딩 중이거나 onYouTubeIframeAPIReady 가 이미 지나간 경우를 위해 폴링 폴백 가동
    const pollInterval = setInterval(() => {
      if (window.YT?.Player) {
        clearInterval(pollInterval);
        onAvailable();
      }
    }, 50);
    // 최대 20초 후 폴링 중지
    setTimeout(() => clearInterval(pollInterval), 20000);
    return true;
  }
  return false;
}

if (typeof window !== "undefined") {
  window.__initYouTubePlayer = () => initializeYouTubePlayer();
  const prevCallback = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = function () {
    prevCallback?.();
    initializeYouTubePlayer();
  };
  // iframe_api가 모듈보다 먼저 준비되었거나, 준비 중인 경우 모두 감지
  whenYouTubeApiAvailable({
    onAvailable: () => initializeYouTubePlayer(),
  });
}

// YT IFrame API 스크립트가 차단되거나 CDN 이 죽으면 playerReady 는 영원히 pending 이다.
// bootstrap 이 조용히 멈추는 대신 시간 초과로 실패시켜 호출부가 사용자에게 알릴 수 있게 한다.
export async function waitForPlayerReady(timeoutMs = 20000) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("YouTube 플레이어 로딩 실패 (시간 초과)")), timeoutMs)
  );
  return Promise.race([playerReady, timeout]);
}

export async function unlockAudio() {
  const player = await playerReady;
  player.mute();
  player.playVideo();
  player.pauseVideo();
  player.unMute();
  applyOutputVolume(lastOutputVolume);
}

// 리스너 로컬 시계와 서버 시계의 오프셋. NTP 방식(왕복시간 절반을 응답시각에 더함)으로 추정한다.
let clockOffsetMs = 0;

export async function syncClockOffset() {
  let bestRtt = Infinity;
  let bestOffset = clockOffsetMs;
  let success = false;

  for (let i = 0; i < 3; i++) {
    try {
      const t0 = Date.now();
      const { data, error } = await supabase.rpc("server_time_ms");
      if (error) break;
      const t1 = Date.now();
      const rtt = t1 - t0;
      const offset = Number(data) + rtt / 2 - t1;
      if (rtt < bestRtt) {
        bestRtt = rtt;
        bestOffset = offset;
        success = true;
      }
      if (rtt < 80) break;
    } catch (err) {
      break;
    }
  }

  if (success) {
    clockOffsetMs = bestOffset;
  }
}

export function nowMs() {
  return Date.now() + clockOffsetMs;
}

// 현재 로드된 영상의 길이(초). 아직 메타데이터가 없으면 0.
export function getLoadedDuration() {
  return Number(ytPlayer?.getDuration?.()) || 0;
}

export function getClockOffsetMs() {
  return clockOffsetMs;
}

export async function fetchPlaybackState(roomId) {
  const { data, error } = await supabase
    .from("playback_state").select().eq("room_id", roomId).single();
  if (error) throw error;
  return data;
}

// server_started_at 은 클라이언트가 보내지 않는다. DB 트리거(stamp_server_started_at)가
// is_playing=true 로 바뀔 때마다 서버 시각으로 강제 고정해, DJ 클라이언트 시계 오차가
// 재생 위치 오차로 이어지지 않게 한다.
// 갱신된 행을 그대로 돌려준다. 호출부가 realtime echo 를 기다리지 않고 즉시 적용할 수
// 있어야, postgres_changes 이벤트가 유실되거나 늦어도 재생이 멈추지 않는다.
export async function djSetTrack(roomId, trackId) {
  const { data, error } = await supabase.from("playback_state")
    .update(buildSetTrackUpdate(trackId))
    .eq("room_id", roomId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// restart:true 는 "이미 재생 중인 곡을 같은 위치에서 다시 시작" 을 뜻한다. 값이 하나도
// 바뀌지 않는 UPDATE 가 되므로 restart_token 없이는 server_started_at 이 재각인되지 않는다.
export async function djPlay(roomId, currentPosition, { restart = false } = {}) {
  const update = { is_playing: true, position_at_start: currentPosition };
  if (restart) update.restart_token = generateRestartToken();
  const { error } = await supabase.from("playback_state").update(update).eq("room_id", roomId);
  if (error) throw error;
}

export async function djPause(roomId, currentPosition) {
  const { error } = await supabase.from("playback_state").update({
    is_playing: false,
    position_at_start: currentPosition,
  }).eq("room_id", roomId);
  if (error) throw error;
}

export function subscribePlaybackState(roomId, onChange) {
  return supabase
    .channel(`playback-changes-${roomId}`)
    .on("postgres_changes", {
      event: "*", schema: "public", table: "playback_state", filter: `room_id=eq.${roomId}`,
    }, async () => {
      onChange(await fetchPlaybackState(roomId));
    })
    .subscribe();
}

let currentLoadedVideoId = null;
let lastVideoLoadedAtMs = 0;

export function resetLoadedVideoState() {
  currentLoadedVideoId = null;
  lastVideoLoadedAtMs = 0;
}

export async function applyPlaybackState(state, tracks) {
  const player = await playerReady;
  const track = tracks.find((t) => t.id === state.current_track_id);
  if (!track) return;

  const expected = Math.max(0, computeExpectedPosition({
    isPlaying: state.is_playing,
    positionAtStart: state.position_at_start,
    serverStartedAt: state.server_started_at,
    nowMs: nowMs(),
  }));

  const currentVideoId = player.getVideoData?.()?.video_id;
  const isVideoDifferent = (currentLoadedVideoId !== track.youtube_id) && (currentVideoId !== track.youtube_id);

  if (isVideoDifferent) {
    currentLoadedVideoId = track.youtube_id;
    lastVideoLoadedAtMs = Date.now();
    // 새 영상은 아직 duration 을 모르므로 clamp 대상이 없다. 다만 곡 끝 너머의 값이
    // 그대로 startSeconds 로 들어가면 로드 직후 종료되므로 0 이상만 넘긴다.
    player.loadVideoById(track.youtube_id, Math.max(0, expected));
  } else {
    currentLoadedVideoId = track.youtube_id;
    const actual = player.getCurrentTime?.() ?? 0;
    const playerState = player.getPlayerState?.();
    const timeSinceLoad = Date.now() - lastVideoLoadedAtMs;
    const target = computeSeekTarget({ expected, duration: player.getDuration?.() ?? 0 });

    if (shouldSeekToTarget({ target, actual, playerState, timeSinceLoadMs: timeSinceLoad })) {
      player.seekTo(target, true);
    }
  }

  if (state.is_playing) player.playVideo();
  else player.pauseVideo();
}

// 드리프트 보정은 RLS 로 보호되는 playback_state 를 주기적으로 폴링해서 수행한다.
// Realtime Broadcast 채널은 인증이 없어 anon 키만 있으면 누구나 가짜 위치를 쏴서
// 방 전체를 강제 seek 할 수 있으므로 사용하지 않는다.
export function startDriftCorrection(roomId) {
  setInterval(async () => {
    const player = await playerReady;
    if (!player.getCurrentTime || !player.getPlayerState) return;
    const playerState = player.getPlayerState();
    if (playerState !== 1) return; // 오직 정상 재생 중(PLAYING=1)일 때만 보정

    // 트랙 로드 직후 4초 이내에는 버퍼링/초기 재생 단계이므로 드리프트 보정을 유예한다.
    if (Date.now() - lastVideoLoadedAtMs < 4000) return;

    let state;
    try {
      state = await fetchPlaybackState(roomId);
    } catch (e) {
      return;
    }
    if (!state || !state.is_playing) return;

    const expected = Math.max(0, computeExpectedPosition({
      isPlaying: state.is_playing,
      positionAtStart: state.position_at_start,
      serverStartedAt: state.server_started_at,
      nowMs: nowMs(),
    }));
    const actual = player.getCurrentTime();
    // 곡 끝을 넘어선 목표 위치로는 보정하지 않는다. 그렇게 seek 하면 YouTube 가 즉시
    // ENDED 를 던지고, DJ 의 종료 처리가 playback_state 를 다시 써서 같은 보정이 반복된다.
    const target = computeSeekTarget({ expected, duration: player.getDuration?.() ?? 0 });
    if (target !== null && Math.abs(target - actual) > 1.5) {
      player.seekTo(target, true);
    }
  }, 4000);
}

// 세션 중 로컬 시계가 밀리는 경우(절전 복귀 등)에 대비해 오프셋을 주기적으로 재측정한다.
export function startClockOffsetSync() {
  syncClockOffset();
  setInterval(syncClockOffset, 30_000);
}

export function startProgressBarUpdates({ onUpdate }) {
  setInterval(async () => {
    const player = await playerReady;
    if (!player.getCurrentTime || !player.getDuration) return;
    const duration = player.getDuration();
    if (!duration) return;
    onUpdate({ current: player.getCurrentTime(), duration });
  }, 500);
}

export function applyOutputVolume(percent) {
  lastOutputVolume = percent;
  if (!ytPlayer?.setVolume) return;
  ytPlayer.setVolume(percent);
  if (percent === 0) ytPlayer.mute();
  else ytPlayer.unMute();
}

