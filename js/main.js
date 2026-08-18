import { ensureIdentity } from "./auth.js";
import { claimDjIfVacant, fetchSettings, isCurrentDj } from "./roles.js";
import { initPresence } from "./presence.js";
import { delegateDj } from "./roles.js";
import { addTrack, fetchTracks, subscribeTracks } from "./playlist.js";
import {
  unlockAudio, fetchPlaybackState, subscribePlaybackState, applyPlaybackState,
  djSetTrack, djPlay, djPause, startDriftBroadcast,
} from "./player.js";

function renderPresence(users, myUid, djUid) {
  const list = document.getElementById("presence-list");
  list.innerHTML = "";
  for (const u of users) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = u.nickname + (u.uid === djUid ? "" : "");
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

function renderTracks(tracks) {
  const list = document.getElementById("track-list");
  list.innerHTML = "";
  for (const t of tracks) {
    const li = document.createElement("li");
    li.dataset.trackId = t.id;
    li.textContent = t.title;
    list.appendChild(li);
  }
}

async function bootstrap() {
  const identity = await ensureIdentity();
  await claimDjIfVacant(identity.uid);
  const settings = await fetchSettings();
  const amDj = isCurrentDj(settings, identity.uid);
  document.getElementById("controls-section").classList.toggle("hidden", !amDj);
  document.getElementById("add-track-form").classList.toggle("hidden", !amDj);
  document.getElementById("app").classList.remove("hidden");

  initPresence({
    uid: identity.uid,
    nickname: identity.nickname,
    onSync: (users) => renderPresence(users, identity.uid, settings.dj_uid),
  });

  document.getElementById("add-track-button").addEventListener("click", async () => {
    const input = document.getElementById("youtube-url-input");
    if (!input.value.trim()) return;
    await addTrack({ url: input.value.trim(), uid: identity.uid });
    input.value = "";
  });

  document.getElementById("listen-gate").classList.remove("hidden");
  document.getElementById("listen-start").addEventListener("click", async () => {
    await unlockAudio();
    document.getElementById("listen-gate").classList.add("hidden");
  });

  let currentTracks = await fetchTracks();
  renderTracks(currentTracks);
  subscribeTracks((tracks) => { currentTracks = tracks; renderTracks(tracks); });

  const applyState = async () => {
    const state = await fetchPlaybackState();
    await applyPlaybackState(state, currentTracks);
  };
  await applyState();
  subscribePlaybackState(applyState);
  startDriftBroadcast(amDj);

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
  }
}

bootstrap();
