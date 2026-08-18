export function computeExpectedPosition({ isPlaying, positionAtStart, serverStartedAt }) {
  if (!isPlaying) return positionAtStart;
  const elapsedSec = (Date.now() - new Date(serverStartedAt).getTime()) / 1000;
  return positionAtStart + elapsedSec;
}

import { supabase } from "./supabaseClient.js";

let ytPlayer = null;
let playerReadyResolve;
const playerReady = new Promise((resolve) => { playerReadyResolve = resolve; });

if (typeof window !== "undefined") {
  window.onYouTubeIframeAPIReady = function () {
    ytPlayer = new YT.Player("youtube-player", {
      height: "0",
      width: "0",
      events: {
        onReady: () => playerReadyResolve(ytPlayer),
      },
    });
  };
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

export function startDriftBroadcast(isDj) {
  const channel = supabase.channel("playback-drift");

  if (!isDj) {
    channel.on("broadcast", { event: "drift" }, async ({ payload }) => {
      const player = await playerReady;
      const actual = player.getCurrentTime?.() ?? 0;
      if (Math.abs(payload.position - actual) > 0.5) {
        player.seekTo(payload.position, true);
      }
    });
  }

  channel.subscribe();

  if (isDj) {
    setInterval(async () => {
      const player = await playerReady;
      channel.send({
        type: "broadcast",
        event: "drift",
        payload: { position: player.getCurrentTime() },
      });
    }, 5000);
  }

  return channel;
}
