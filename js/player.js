export function computeExpectedPosition({ isPlaying, positionAtStart, serverStartedAt }) {
  if (!isPlaying) return positionAtStart;
  const elapsedSec = (Date.now() - new Date(serverStartedAt).getTime()) / 1000;
  return positionAtStart + elapsedSec;
}

export function getPlaybackTogglePresentation(isPlaying) {
  return isPlaying
    ? { icon: "Ⅱ", label: "일시정지" }
    : { icon: "▶", label: "재생" };
}

import { supabase } from "./supabaseClient.js";

let ytPlayer = null;
let playerReadyResolve;
const playerReady = new Promise((resolve) => { playerReadyResolve = resolve; });

export function initializeYouTubePlayer({ YT: youtubeApi, onReady } = {}) {
  const api = youtubeApi ?? (typeof window !== "undefined" ? window.YT : undefined);
  if (!api?.Player || ytPlayer) {
    return false;
  }

  let createdPlayer;
  createdPlayer = new api.Player("youtube-player", {
    height: "0",
    width: "0",
    events: {
      onReady: (event) => {
        ytPlayer = event.target ?? createdPlayer;
        playerReadyResolve(ytPlayer);
        onReady?.(ytPlayer);
      },
    },
  });
  // YouTube API의 onReady는 보통 비동기로 오지만, 테스트/래퍼 구현은 즉시 호출할 수 있다.
  // 즉시 호출된 경우 onReady에서 확정한 인스턴스를 덮어쓰지 않는다.
  if (!ytPlayer) ytPlayer = createdPlayer;
  return true;
}

export function whenYouTubeApiAvailable({ YT: youtubeApi, onAvailable } = {}) {
  if (youtubeApi?.Player) {
    onAvailable();
    return true;
  }
  if (typeof youtubeApi?.ready === "function") {
    youtubeApi.ready(() => {
      onAvailable();
    });
    return true;
  }
  return false;
}

if (typeof window !== "undefined") {
  window.onYouTubeIframeAPIReady = function () {
    initializeYouTubePlayer();
  };
  // iframe_api가 모듈보다 먼저 준비된 경우 콜백은 이미 지나간다.
  // 이때도 즉시 생성해 playerReady가 영구 대기 상태가 되지 않게 한다.
  whenYouTubeApiAvailable({
    YT: window.YT,
    onAvailable: () => initializeYouTubePlayer(),
  });
}

// YT IFrame API 스크립트가 차단되거나 CDN 이 죽으면 playerReady 는 영원히 pending 이다.
// bootstrap 이 조용히 멈추는 대신 시간 초과로 실패시켜 호출부가 사용자에게 알릴 수 있게 한다.
export async function waitForPlayerReady(timeoutMs = 15000) {
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
}

export async function fetchPlaybackState() {
  const { data, error } = await supabase.from("playback_state").select().eq("id", 1).single();
  if (error) throw error;
  return data;
}

export async function djSetTrack(trackId) {
  const { error } = await supabase.from("playback_state").update({
    current_track_id: trackId,
    is_playing: true,
    position_at_start: 0,
    server_started_at: new Date().toISOString(),
  }).eq("id", 1);
  if (error) throw error;
}

export async function djPlay(currentPosition) {
  const { error } = await supabase.from("playback_state").update({
    is_playing: true,
    position_at_start: currentPosition,
    server_started_at: new Date().toISOString(),
  }).eq("id", 1);
  if (error) throw error;
}

export async function djPause(currentPosition) {
  const { error } = await supabase.from("playback_state").update({
    is_playing: false,
    position_at_start: currentPosition,
  }).eq("id", 1);
  if (error) throw error;
}

export function subscribePlaybackState(onChange) {
  return supabase
    .channel("playback-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "playback_state" }, async () => {
      onChange(await fetchPlaybackState());
    })
    .subscribe();
}

export async function applyPlaybackState(state, tracks) {
  const player = await playerReady;
  const track = tracks.find((t) => t.id === state.current_track_id);
  if (!track) return;

  // fetchPlaybackState() returns raw DB columns (snake_case); computeExpectedPosition
  // expects the camelCase shape from Task 2. Map explicitly rather than changing that
  // function's signature.
  const expected = computeExpectedPosition({
    isPlaying: state.is_playing,
    positionAtStart: state.position_at_start,
    serverStartedAt: state.server_started_at,
  });

  const current = player.getVideoData?.()?.video_id;
  if (current !== track.youtube_id) {
    player.loadVideoById(track.youtube_id, expected);
  }

  const actual = player.getCurrentTime?.() ?? 0;
  if (Math.abs(expected - actual) > 0.5) {
    player.seekTo(expected, true);
  }

  if (state.is_playing) player.playVideo();
  else player.pauseVideo();
}

// 드리프트 보정은 RLS 로 보호되는 playback_state 를 주기적으로 폴링해서 수행한다.
// Realtime Broadcast 채널은 인증이 없어 anon 키만 있으면 누구나 가짜 위치를 쏴서
// 방 전체를 강제 seek 할 수 있으므로 사용하지 않는다.
export function startDriftCorrection() {
  setInterval(async () => {
    const player = await playerReady;
    if (!player.getCurrentTime) return;
    const state = await fetchPlaybackState();
    if (!state.is_playing) return;
    const expected = computeExpectedPosition({
      isPlaying: state.is_playing,
      positionAtStart: state.position_at_start,
      serverStartedAt: state.server_started_at,
    });
    const actual = player.getCurrentTime();
    if (Math.abs(expected - actual) > 0.5) {
      player.seekTo(expected, true);
    }
  }, 5000);
}
