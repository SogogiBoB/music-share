import { ensureIdentity } from "./auth.js";
import {
  claimDjIfVacant, fetchSettings, isCurrentDj, delegateDj,
  releaseDj, fetchProfiles, subscribeSettings,
} from "./roles.js";
import { initPresence } from "./presence.js";
import { addTrack, fetchTracks, subscribeTracks } from "./playlist.js";
import {
  unlockAudio, fetchPlaybackState, subscribePlaybackState, applyPlaybackState,
  djSetTrack, djPlay, djPause, startDriftCorrection, waitForPlayerReady,
} from "./player.js";

function renderPresence(users, myUid, djUid, profileNicknames) {
  const list = document.getElementById("presence-list");
  list.innerHTML = "";
  for (const u of users) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    // presence 메타데이터는 위조 가능하므로 profiles(RLS 보호) 의 닉네임을 우선한다.
    // 프로필 행이 아직 없는 순간에만 presence 값으로 폴백한다.
    label.textContent = profileNicknames[u.uid] ?? u.nickname;
    li.appendChild(label);
    if (u.uid === djUid) {
      const badge = document.createElement("span");
      badge.className = "badge-dj";
      badge.textContent = "DJ";
      li.appendChild(badge);
    }
    if (djUid === myUid && u.uid !== myUid) {
      const btn = document.createElement("button");
      btn.textContent = "DJ 위임";
      btn.addEventListener("click", async () => {
        await delegateDj(u.uid);
        location.reload();
      });
      li.appendChild(btn);
    }
    list.appendChild(li);
  }
}

function renderTracks(tracks, amDj) {
  const list = document.getElementById("track-list");
  list.innerHTML = "";
  for (const t of tracks) {
    const li = document.createElement("li");
    li.dataset.trackId = t.id;
    li.textContent = t.title;
    if (amDj) {
      li.style.cursor = "pointer";
      li.addEventListener("click", async () => {
        await djSetTrack(t.id);
      });
    }
    list.appendChild(li);
  }
}

async function loadProfileNicknames() {
  const profiles = await fetchProfiles();
  return Object.fromEntries(profiles.map((p) => [p.uid, p.nickname]));
}

async function bootstrap() {
  const identity = await ensureIdentity();
  await claimDjIfVacant(identity.uid);
  const settings = await fetchSettings();
  const amDj = isCurrentDj(settings, identity.uid);
  document.getElementById("controls-section").classList.toggle("hidden", !amDj);
  document.getElementById("add-track-form").classList.toggle("hidden", !amDj);
  document.getElementById("app").classList.remove("hidden");

  let profileNicknames = await loadProfileNicknames();

  initPresence({
    uid: identity.uid,
    nickname: identity.nickname,
    onSync: async (users) => {
      // 새로 들어온 사람의 프로필을 반영하려면 sync 마다 다시 읽는다.
      // (subscribeTracks 가 변경마다 전체를 refetch 하는 것과 같은 패턴)
      try {
        profileNicknames = await loadProfileNicknames();
      } catch (err) {
        console.error(err);
      }
      renderPresence(users, identity.uid, settings.dj_uid, profileNicknames);
    },
  });

  // dj_uid 가 바뀌면(위임/반납) 모든 탭이 새 역할로 다시 뜬다.
  subscribeSettings(() => location.reload());

  // DJ 가 탭을 닫으면 역할을 반납해 방이 영구히 DJ 없는 상태가 되지 않게 한다.
  // DJ 가 아니면 release_dj() 는 아무 것도 하지 않는다.
  window.addEventListener("pagehide", () => {
    releaseDj().catch(() => {});
  });

  document.getElementById("add-track-button").addEventListener("click", async () => {
    const input = document.getElementById("youtube-url-input");
    if (!input.value.trim()) return;
    await addTrack({ url: input.value.trim(), uid: identity.uid });
    input.value = "";
  });

  let currentTracks = await fetchTracks();
  renderTracks(currentTracks, amDj);
  subscribeTracks((tracks) => { currentTracks = tracks; renderTracks(tracks, amDj); });

  const applyState = async () => {
    const state = await fetchPlaybackState();
    await applyPlaybackState(state, currentTracks);
  };

  document.getElementById("listen-gate").classList.remove("hidden");
  document.getElementById("listen-start").addEventListener("click", async () => {
    await unlockAudio();
    document.getElementById("listen-gate").classList.add("hidden");
    // unlockAudio() 의 play/pause 로 플레이어가 멈춰 있으므로 실제 상태를 다시 적용한다.
    // 이게 없으면 곡 중간에 들어온 사람은 영원히 무음이다.
    await applyState();
  });

  let playerOk = true;
  try {
    await waitForPlayerReady();
  } catch (err) {
    playerOk = false;
    console.error(err);
    alert("음악 플레이어를 불러오지 못했습니다. 새로고침해 주세요.");
  }

  if (playerOk) {
    // 최초 1회: loadVideoById 로 영상을 물려두어야 unlockAudio() 의 play/pause 가 의미를 갖는다.
    await applyState();
    subscribePlaybackState(applyState);
    startDriftCorrection();
  }

  if (amDj) {
    document.getElementById("play-button").addEventListener("click", async () => {
      const state = await fetchPlaybackState();
      if (!state.current_track_id && currentTracks[0]) {
        await djSetTrack(currentTracks[0].id);
      } else {
        await djPlay(state.position_at_start);
      }
    });
    document.getElementById("pause-button").addEventListener("click", async () => {
      const state = await fetchPlaybackState();
      await djPause(state.position_at_start);
    });
    document.getElementById("next-button").addEventListener("click", async () => {
      const state = await fetchPlaybackState();
      const currentIndex = currentTracks.findIndex((t) => t.id === state.current_track_id);
      const next = currentTracks[currentIndex + 1];
      if (next) {
        await djSetTrack(next.id);
      }
    });
  }
}

bootstrap();
