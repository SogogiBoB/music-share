import { ensureIdentity, signOut } from "./auth.js";
import { initPlaylistUI } from "./playlistUI.js";
import {
  takeOverDj, fetchSettings, isCurrentDj, delegateDj,
  releaseDj, heartbeatDj, fetchProfiles, subscribeSettings, isDjLeaseExpired, shouldNotifyDjTakeover,
  getRoomViewState, canDelegateTo,
} from "./roles.js";
import { initPresence } from "./presence.js";
import { addTrack, fetchTracks, subscribeTracks, deleteTrack, addTrackFromLibrary } from "./playlist.js";
import { fetchPlaylists, fetchPlaylistTracks, partitionLibraryTracks, addTrackToPlaylist } from "./playlists.js";
import {
  unlockAudio, fetchPlaybackState, subscribePlaybackState, applyPlaybackState,
  djSetTrack, djPlay, djPause, startDriftCorrection, waitForPlayerReady, getPlaybackTogglePresentation,
  startClockOffsetSync, startProgressBarUpdates, applyOutputVolume, formatClock,
  computeExpectedPosition, computePrevTrackAction, computeNextTrackOnEnded, setPlayerStateChangeHandler,
  syncClockOffset, nowMs, clampPositionToDuration, getLoadedDuration,
} from "./player.js";
import { computeOutputVolume, clampVolume, loadMyVolume, saveMyVolume, setMasterVolume } from "./volume.js";

function renderNowPlaying(tracks, currentTrackId) {
  const track = tracks.find((t) => t.id === currentTrackId);
  const nowTitle = document.getElementById("now-title");
  const nowSub = document.getElementById("now-sub");
  if (nowTitle) nowTitle.textContent = track ? track.title : "—";
  if (nowSub) {
    nowSub.textContent = track
      ? "모두 같은 지점에서 듣는 중"
      : "DJ가 곡을 고르는 중이에요";
  }
}

function renderPresence(users, myUid, djUid, profiles) {
  const list = document.getElementById("presence-list");
  const count = document.getElementById("presence-count");
  list.innerHTML = "";
  count.textContent = String(users.length);
  for (const u of users) {
    const isDj = u.uid === djUid;
    const profile = profiles[u.uid];
    const nickname = String(profile?.nickname ?? u.nickname ?? "게스트");

    const li = document.createElement("li");
    li.className = "preset";
    if (isDj) li.classList.add("is-dj");
    if (profile?.is_guest) li.classList.add("is-guest");

    const top = document.createElement("div");
    top.className = "preset-top";

    const cap = document.createElement("span");
    cap.className = "cap";
    cap.setAttribute("aria-hidden", "true");
    cap.textContent = nickname.trim().charAt(0).toUpperCase() || "♪";

    const copy = document.createElement("span");
    const name = document.createElement("span");
    name.className = "nm";
    name.textContent = nickname;
    const role = document.createElement("span");
    role.className = "rl";
    role.textContent = (u.uid === myUid ? "나 · " : "") + (isDj ? "dj" : profile?.is_guest ? "게스트" : "리스너");
    copy.append(name, role);

    top.append(cap, copy);

    if (isDj) {
      const lamp = document.createElement("i");
      lamp.className = "lamp";
      lamp.setAttribute("aria-label", "DJ");
      top.appendChild(lamp);
    }

    if (djUid === myUid && u.uid !== myUid && canDelegateTo(profile)) {
      const btn = document.createElement("button");
      btn.className = "assign";
      btn.type = "button";
      btn.textContent = "DJ 위임";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await delegateDj(u.uid);
          location.reload();
        } catch (err) {
          btn.disabled = false;
          console.error(err);
          alert("DJ 역할을 위임하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
      });
      top.appendChild(btn);
    }

    if (u.uid === myUid) li.classList.add("is-me");
    li.append(top);

    list.appendChild(li);
  }
}

function renderTracks(tracks, amDj, currentTrackId) {
  const list = document.getElementById("track-list");
  const queueCount = document.getElementById("queue-count");
  if (queueCount) queueCount.textContent = String(tracks.length).padStart(2, "0");
  list.innerHTML = "";
  if (!tracks.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.innerHTML = `
      <span class="empty-state-icon" aria-hidden="true">♫</span>
      <strong>아직 추가된 음악이 없어요</strong>
      <span>${amDj ? "위에 유튜브 링크를 붙여 첫 곡을 추가해 보세요." : "DJ가 곧 첫 곡을 골라 줄 거예요."}</span>
    `;
    list.appendChild(empty);
    return;
  }

  tracks.forEach((t, index) => {
    const isLive = t.id === currentTrackId;
    const li = document.createElement("li");
    li.className = "strip";
    li.dataset.trackId = t.id;
    if (isLive) li.classList.add("is-live");

    const number = document.createElement("span");
    number.className = "no";
    number.textContent = String(index + 1).padStart(2, "0");

    const bulb = document.createElement("i");
    bulb.className = "bulb";

    const row = document.createElement(amDj ? "button" : "span");
    row.className = "tt";
    if (amDj) {
      row.type = "button";
      row.setAttribute("aria-label", `${t.title} 재생`);
      row.addEventListener("click", async () => {
        row.disabled = true;
        try {
          await djSetTrack(t.id);
        } catch (err) {
          console.error(err);
          alert("곡을 재생하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        } finally {
          row.disabled = false;
        }
      });
    }
    row.textContent = t.title;

    li.append(number, bulb, row);

    if (amDj) {
      const cue = document.createElement("button");
      cue.type = "button";
      cue.className = "cue";
      cue.setAttribute("aria-label", `${t.title} 재생`);
      cue.textContent = isLive ? "재생 중" : "cue";
      cue.addEventListener("click", async (event) => {
        event.stopPropagation();
        cue.disabled = true;
        try {
          await djSetTrack(t.id);
        } catch (err) {
          console.error(err);
          alert("곡을 재생하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        } finally {
          cue.disabled = false;
        }
      });
      li.appendChild(cue);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "rm";
      del.setAttribute("aria-label", `${t.title} 삭제`);
      del.textContent = "×";
      del.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (!confirm(`"${t.title}"을(를) 재생목록에서 삭제할까요?`)) return;
        del.disabled = true;
        try {
          await deleteTrack(t.id);
        } catch (err) {
          console.error(err);
          alert("곡을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
          del.disabled = false;
        }
      });
      li.appendChild(del);
    }

    list.appendChild(li);
  });
}

function renderRoomAccess(settings, identity) {
  const view = getRoomViewState({ settingsRow: settings, uid: identity.uid, isGuest: identity.isGuest });
  const button = document.getElementById("dj-claim-button");
  const status = document.getElementById("dj-claim-status");
  const leaseExpired = isDjLeaseExpired(settings);

  button.classList.toggle("hidden", !view.showClaimButton);
  button.disabled = false;
  document.getElementById("playlist-section").classList.toggle("hidden", !view.showQueuePanel);
  document.getElementById("controls-section").classList.toggle("hidden", !view.showTransport);
  document.getElementById("main-tab-playlists").classList.toggle("hidden", !view.showLibraryTab);
  document.getElementById("listener-note").classList.toggle("hidden", view.amDj);

  status.textContent = view.amDj ? "현재 DJ입니다"
    : view.isGuest ? "게스트로 듣는 중이에요"
    : (leaseExpired ? "이전 DJ 연결이 끊겼어요" : "DJ가 음악을 고르고 있어요");

  return view;
}

function updatePlaybackToggle(isPlaying) {
  const button = document.getElementById("play-button");
  if (button) {
    const { icon, label } = getPlaybackTogglePresentation(isPlaying);
    button.setAttribute("aria-label", label);
    button.dataset.state = isPlaying ? "playing" : "paused";
    const span = button.querySelector("span");
    if (span) span.textContent = icon;
  }
  document.querySelector(".vu")?.classList.toggle("is-playing", Boolean(isPlaying));
}

function startDjHeartbeat() {
  const heartbeat = async () => {
    try {
      const retained = await heartbeatDj();
      if (!retained) location.reload();
    } catch (err) {
      console.error("DJ heartbeat failed", err);
    }
  };
  window.setInterval(heartbeat, 15_000);
}

async function loadProfiles() {
  const profiles = await fetchProfiles();
  return Object.fromEntries(profiles.map((p) => [p.uid, p]));
}

async function bootstrap() {
  const identity = await ensureIdentity();
  let settings = await fetchSettings();
  let amDj = isCurrentDj(settings, identity.uid);
  document.getElementById("add-track-form").classList.toggle("hidden", !amDj);
  let currentView = renderRoomAccess(settings, identity);
  document.getElementById("app").classList.remove("hidden");

  let masterVolume = { value: settings.master_volume ?? 100, muted: false };
  let myVolume = loadMyVolume();

  const ARC = 235.6;
  function updateKnobUI(containerId, value, muted, locked) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.classList.toggle("is-muted", muted);
    if (locked !== undefined) el.classList.toggle("is-locked", locked);
    const cap = el.querySelector(".vk-cap");
    const arcFill = el.querySelector(".vk-arc-fill");
    if (cap) cap.style.transform = `rotate(${-135 + 270 * value / 100}deg)`;
    if (arcFill) arcFill.style.strokeDashoffset = String(ARC * (1 - (muted ? 0 : value) / 100));
  }

  function renderVolume(view) {
    const out = computeOutputVolume({
      master: masterVolume.value, mine: myVolume.value,
      masterMuted: masterVolume.muted, myMuted: myVolume.muted,
    });
    applyOutputVolume(out);
    document.getElementById("master-volume-num").textContent = masterVolume.muted ? "음소거" : masterVolume.value;
    document.getElementById("my-volume-num").textContent = myVolume.muted ? "음소거" : myVolume.value;
    document.getElementById("output-volume-num").textContent = out;
    document.getElementById("output-volume-bar").style.width = `${out}%`;
    document.getElementById("output-volume-calc").textContent =
      `MASTER ${masterVolume.muted ? "MUTE" : masterVolume.value} × MY ${myVolume.muted ? "MUTE" : myVolume.value}`;

    const masterInput = document.getElementById("master-volume-input");
    masterInput.value = masterVolume.value;
    masterInput.disabled = !view.amDj;
    document.getElementById("master-volume-mute").disabled = !view.amDj;
    document.getElementById("master-volume-tag").textContent =
      view.amDj ? "DJ 전용 · 방 전체 기준" : "DJ만 조절 · 잠김";
    document.getElementById("my-volume-input").value = myVolume.value;

    updateKnobUI("master-volume", masterVolume.value, masterVolume.muted, !view.amDj);
    updateKnobUI("my-volume", myVolume.value, myVolume.muted, false);
  }

  renderVolume(currentView);

  let presenceChannel = null;

  document.getElementById("my-volume-input").addEventListener("input", (e) => {
    myVolume = { value: clampVolume(e.target.value), muted: false };
    saveMyVolume(myVolume);
    renderVolume(currentView);
    presenceChannel?.track({ uid: identity.uid, nickname: identity.nickname, volume: myVolume.value, muted: myVolume.muted });
  });
  document.getElementById("my-volume-mute").addEventListener("click", () => {
    myVolume = { ...myVolume, muted: !myVolume.muted };
    saveMyVolume(myVolume);
    renderVolume(currentView);
    presenceChannel?.track({ uid: identity.uid, nickname: identity.nickname, volume: myVolume.value, muted: myVolume.muted });
  });
  document.getElementById("master-volume-input").addEventListener("input", (e) => {
    masterVolume = { ...masterVolume, value: clampVolume(e.target.value), muted: false };
    renderVolume(currentView);
  });
  document.getElementById("master-volume-input").addEventListener("change", async (e) => {
    const next = clampVolume(e.target.value);
    const status = document.getElementById("volume-status");
    try {
      const ok = await setMasterVolume(next);
      if (!ok) {
        // DJ 자격을 잃은 사이에 조작한 경우. 서버 값으로 되돌린다.
        masterVolume = { value: (await fetchSettings()).master_volume ?? 100, muted: masterVolume.muted };
        status.textContent = "마스터 볼륨을 저장하지 못했어요. DJ 권한을 확인해 주세요.";
      } else {
        masterVolume = { ...masterVolume, value: next };
        status.textContent = "";
      }
    } catch (err) {
      // RPC/컬럼이 아직 없는 등 서버 쪽 원인이면 내 화면만 바뀐 채 다른 사람에게는 전달되지 않는다.
      // 조용히 실패해서 DJ가 "적용됐다"고 착각하지 않도록 반드시 알린다.
      console.error(err);
      masterVolume = { value: (await fetchSettings().catch(() => settings)).master_volume ?? masterVolume.value, muted: masterVolume.muted };
      status.textContent = "마스터 볼륨이 서버에 저장되지 않았어요. 다른 사람에게는 적용되지 않습니다.";
    }
    renderVolume(currentView);
  });
  document.getElementById("master-volume-mute").addEventListener("click", () => {
    masterVolume = { ...masterVolume, muted: !masterVolume.muted };
    renderVolume(currentView);
  });

  document.getElementById("logout-button").addEventListener("click", async () => {
    await signOut();
    location.reload();
  });

  let playlistUIStarted = false;
  function selectMainTab(which) {
    const isRoom = which === "room";
    document.getElementById("main-tab-room").setAttribute("aria-selected", String(isRoom));
    document.getElementById("main-tab-playlists").setAttribute("aria-selected", String(!isRoom));
    document.getElementById("room-view").classList.toggle("hidden", !isRoom);
    document.getElementById("playlists-view").classList.toggle("hidden", isRoom);
    if (!isRoom && !playlistUIStarted) {
      playlistUIStarted = true;
      initPlaylistUI({ ownerUid: identity.uid, amDj });
    }
  }
  document.getElementById("main-tab-room").addEventListener("click", () => selectMainTab("room"));
  document.getElementById("main-tab-playlists").addEventListener("click", () => selectMainTab("playlists"));

  let profiles = await loadProfiles();

  presenceChannel = initPresence({
    uid: identity.uid,
    nickname: identity.nickname,
    getVolume: () => myVolume,
    onSync: async (users) => {
      // 새로 들어온 사람의 프로필을 반영하려면 sync 마다 다시 읽는다.
      // (subscribeTracks 가 변경마다 전체를 refetch 하는 것과 같은 패턴)
      try {
        profiles = await loadProfiles();
      } catch (err) {
        console.error(err);
      }
      renderPresence(users, identity.uid, settings.dj_uid, profiles);
    },
  });

  let takingOverDj = false;
  // heartbeat 는 만료 시각만 바꾸므로, 역할 UID가 바뀔 때만 화면을 새로 고친다.
  subscribeSettings((payload) => {
    if (payload.new?.master_volume !== undefined) {
      masterVolume.value = payload.new.master_volume;
      renderVolume(currentView);
    }
    if (takingOverDj && payload.new?.dj_uid === identity.uid) return;
    if (payload.new?.dj_uid !== settings.dj_uid) {
      if (shouldNotifyDjTakeover(settings, payload.new, identity.uid)) {
        alert("다른 사용자가 DJ가 되었습니다. 이제 리스너로 함께 들어요.");
      }
      location.reload();
    }
  });

  document.getElementById("dj-claim-button").addEventListener("click", async () => {
    const button = document.getElementById("dj-claim-button");
    const status = document.getElementById("dj-claim-status");
    button.disabled = true;
    status.textContent = "DJ 권한을 요청하는 중…";
    try {
      takingOverDj = true;
      const tookOver = await takeOverDj();
      if (!tookOver) {
        takingOverDj = false;
        currentView = renderRoomAccess(await fetchSettings(), identity);
        renderVolume(currentView);
        status.textContent = "DJ 권한을 가져오지 못했어요. 다시 시도해 주세요.";
        return;
      }
      settings = { ...settings, dj_uid: identity.uid };
      amDj = true;
      document.getElementById("add-track-form").classList.remove("hidden");
      currentView = renderRoomAccess(settings, identity);
      renderVolume(currentView);
      renderTracks(currentTracks, amDj, currentTrackId);
      renderLibraryPicker().catch(console.error);
      enableDjControls();
      startDjHeartbeat();
      await applyState();
      status.textContent = "DJ 권한을 가져왔어요.";
    } catch (err) {
      takingOverDj = false;
      console.error(err);
      button.disabled = false;
      status.textContent = "DJ 권한을 가져오지 못했어요. 다시 시도해 주세요.";
    }
  });

  // DJ 가 탭을 닫으면 역할을 반납해 방이 영구히 DJ 없는 상태가 되지 않게 한다.
  // DJ 가 아니면 release_dj() 는 아무 것도 하지 않는다.
  window.addEventListener("pagehide", () => {
    releaseDj().catch(() => {});
  });

  if (amDj) startDjHeartbeat();

  initSaveToPlaylist().catch(console.error);

  async function initSaveToPlaylist() {
    if (identity.isGuest) return;
    const row = document.getElementById("save-to-playlist-row");
    const select = document.getElementById("save-to-playlist-select");
    const check = document.getElementById("save-to-playlist-check");
    if (!row || !select || !check) return;

    const playlists = await fetchPlaylists(identity.uid);
    if (playlists.length > 0) {
      row.classList.remove("hidden");
      select.innerHTML = '<option value="">(재생목록 선택)</option>';
      playlists.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = String(p.id);
        opt.textContent = p.name;
        select.appendChild(opt);
      });
      check.addEventListener("change", () => {
        select.disabled = !check.checked;
      });
    }
  }

  document.getElementById("add-track-button").addEventListener("click", async () => {
    const input = document.getElementById("youtube-url-input");
    const button = document.getElementById("add-track-button");
    const status = document.getElementById("add-track-status");
    const url = input.value.trim();
    status.className = "note";
    if (!url) {
      status.classList.add("err");
      status.textContent = "추가할 유튜브 링크를 입력해 주세요.";
      input.focus();
      return;
    }
    button.disabled = true;
    button.textContent = "추가 중…";
    status.textContent = "곡 정보를 확인하고 있어요.";
    try {
      const added = await addTrack({ url, uid: identity.uid });
      const check = document.getElementById("save-to-playlist-check");
      const select = document.getElementById("save-to-playlist-select");
      if (check?.checked && select?.value && added) {
        try {
          await addTrackToPlaylist({
            playlistId: Number(select.value),
            youtubeId: added.youtubeId,
            title: added.title,
          });
        } catch (saveErr) {
          console.warn("내 재생목록 추가 실패 또는 중복:", saveErr.message);
        }
      }
      input.value = "";
      status.classList.add("ok");
      status.textContent = "재생목록에 추가했어요.";
    } catch (err) {
      console.error(err);
      status.classList.add("err");
      status.textContent = err.message === "유효하지 않은 유튜브 링크"
        ? "올바른 유튜브 링크를 입력해 주세요."
        : "곡을 추가하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    } finally {
      button.disabled = false;
      button.textContent = "추가";
    }
  });

  document.getElementById("youtube-url-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") document.getElementById("add-track-button").click();
  });

  let currentTracks = await fetchTracks();
  let currentTrackId = null;
  let repeatMode = localStorage.getItem("sugar_dj_repeat") || "off";

  function updateRepeatButtonUI() {
    const btn = document.getElementById("repeat-button");
    if (!btn) return;
    btn.classList.remove("is-off", "is-all", "is-one");
    if (repeatMode === "off") {
      btn.classList.add("is-off");
      btn.setAttribute("aria-label", "반복 재생 (꺼짐)");
    } else if (repeatMode === "all") {
      btn.classList.add("is-all");
      btn.setAttribute("aria-label", "전체 반복");
    } else if (repeatMode === "one") {
      btn.classList.add("is-one");
      btn.setAttribute("aria-label", "한곡 반복");
    }
  }
  updateRepeatButtonUI();

  setPlayerStateChangeHandler(async (event) => {
    if (event.data === 0) { // YT.PlayerState.ENDED
      if (!amDj) return;
      const state = await fetchPlaybackState();
      const nextAction = computeNextTrackOnEnded({
        tracks: currentTracks,
        currentTrackId: state.current_track_id,
        repeatMode,
      });
      if (nextAction.action === "play") {
        await djSetTrack(nextAction.trackId);
      } else if (nextAction.action === "stop") {
        const duration = event.target?.getDuration?.() ?? 0;
        await djPause(duration);
      }
    }
  });

  async function renderLibraryPicker() {
    if (identity.isGuest) return;
    const select = document.getElementById("library-picker-select");
    const list = document.getElementById("library-picker-list");
    const note = document.getElementById("library-picker-note");
    const allButton = document.getElementById("library-picker-all");
    if (!select || !list || !note || !allButton) return;

    const playlists = await fetchPlaylists(identity.uid);
    if (select.options.length !== playlists.length) {
      select.innerHTML = "";
      playlists.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = String(p.id);
        opt.textContent = p.name;
        select.appendChild(opt);
      });
    }
    if (!playlists.length) {
      note.textContent = "내 재생목록이 아직 없어요.";
      list.innerHTML = "";
      allButton.disabled = true;
      return;
    }

    const libraryTracks = await fetchPlaylistTracks(Number(select.value || playlists[0].id));
    const { addable, already } = partitionLibraryTracks(libraryTracks, currentTracks);

    list.innerHTML = "";
    libraryTracks.forEach((t, index) => {
      const li = document.createElement("li");
      const no = document.createElement("span");
      no.className = "no";
      no.textContent = String(index + 1).padStart(2, "0");
      const title = document.createElement("span");
      title.className = "tt";
      title.textContent = t.title;
      const button = document.createElement("button");
      button.className = "key pick-add";
      button.type = "button";
      const isIn = already.some((x) => x.youtube_id === t.youtube_id);
      button.textContent = isIn ? "대기열에 있음" : "＋ 대기열";
      button.disabled = isIn;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await addTrackFromLibrary({ youtubeId: t.youtube_id, title: t.title, uid: identity.uid });
        } catch (err) {
          note.textContent = err.message;
          button.disabled = false;
          return;
        }
        currentTracks = await fetchTracks();
        await renderLibraryPicker();
      });
      li.append(no, title, button);
      list.appendChild(li);
    });

    const selectedOption = select.selectedOptions[0];
    const playlistTitle = selectedOption ? selectedOption.textContent : "";
    note.textContent = addable.length
      ? `${playlistTitle} · 아직 대기열에 없는 곡 ${addable.length}개`
      : `${playlistTitle} · 전부 대기열에 들어가 있어요`;
    allButton.disabled = addable.length === 0;
  }

  document.getElementById("library-picker-select")?.addEventListener("change", renderLibraryPicker);
  document.getElementById("library-picker-all")?.addEventListener("click", async () => {
    const select = document.getElementById("library-picker-select");
    if (!select?.value) return;
    const list = await fetchPlaylistTracks(Number(select.value));
    const { addable } = partitionLibraryTracks(list, currentTracks);
    for (const t of addable) {
      await addTrackFromLibrary({ youtubeId: t.youtube_id, title: t.title, uid: identity.uid });
    }
    currentTracks = await fetchTracks();
    await renderLibraryPicker();
  });

  renderTracks(currentTracks, amDj, currentTrackId);
  renderNowPlaying(currentTracks, currentTrackId);
  renderLibraryPicker().catch(console.error);
  subscribeTracks((tracks) => {
    currentTracks = tracks;
    renderTracks(tracks, amDj, currentTrackId);
    renderNowPlaying(tracks, currentTrackId);
    renderLibraryPicker().catch(console.error);
  });

  const applyState = async (state) => {
    const nextState = state ?? await fetchPlaybackState();
    updatePlaybackToggle(nextState.is_playing);
    if (nextState.current_track_id !== currentTrackId) {
      currentTrackId = nextState.current_track_id;
      renderTracks(currentTracks, amDj, currentTrackId);
      renderNowPlaying(currentTracks, currentTrackId);
    }
    await applyPlaybackState(nextState, currentTracks);
  };

  const listenGate = document.getElementById("listen-gate");
  const listenStart = document.getElementById("listen-start");

  let playerOk = true;
  try {
    await waitForPlayerReady();
  } catch (err) {
    playerOk = false;
    console.error(err);
    alert("음악 플레이어를 불러오지 못했습니다. 새로고침해 주세요.");
  }

  if (identity.fromPrompt) {
    listenGate?.classList.add("hidden");
    if (playerOk) {
      await unlockAudio().catch(console.error);
    }
  } else {
    listenGate?.classList.remove("hidden");
    listenStart?.addEventListener("click", async () => {
      listenStart.disabled = true;
      try {
        await unlockAudio();
        listenGate.classList.add("hidden");
        await applyState();
      } catch (err) {
        console.error(err);
      } finally {
        listenStart.disabled = false;
      }
    });
  }

  if (playerOk) {
    await syncClockOffset();
    startClockOffsetSync();
    // 최초 1회: loadVideoById 로 영상을 물려두어야 unlockAudio() 의 play/pause 가 의미를 갖는다.
    await applyState();
    subscribePlaybackState(applyState);
    startDriftCorrection();
    startProgressBarUpdates({
      onUpdate: ({ current, duration }) => {
        const percent = Math.min(100, (current / duration) * 100);
        const fill = document.getElementById("playback-progress-fill");
        const bar = document.getElementById("playback-progress");
        const head = document.querySelector("#playback-progress .head");
        const elapsed = document.getElementById("now-elapsed");
        const remain = document.getElementById("now-remain");

        if (fill) fill.style.width = `${percent}%`;
        if (bar) bar.setAttribute("aria-valuenow", String(Math.round(percent)));
        if (head) head.style.left = `${percent}%`;
        if (elapsed) elapsed.textContent = formatClock(current);
        if (remain) remain.textContent = `-${formatClock(duration - current)}`;
      },
    });
  }

  let djControlsBound = false;
  function enableDjControls() {
    if (djControlsBound) return;
    djControlsBound = true;
    document.getElementById("play-button").addEventListener("click", async () => {
      const state = await fetchPlaybackState();
      if (state.is_playing) {
        // state.position_at_start 는 "마지막으로 재생을 시작한 시점"의 위치일 뿐,
        // 지금 실제로 어디까지 재생됐는지가 아니다. 그대로 넘기면 일시정지할 때마다
        // 경과 시간이 사라지고, 다음 재생이 그 시작 지점부터 다시 튄다.
        // 곡이 끝난 뒤에도 경과 시간은 계속 늘어나므로, 곡 길이를 넘는 위치가
        // position_at_start 로 저장되지 않도록 반드시 곡 끝으로 제한한다.
        const duration = getLoadedDuration();
        const currentPosition = clampPositionToDuration(computeExpectedPosition({
          isPlaying: state.is_playing,
          positionAtStart: state.position_at_start,
          serverStartedAt: state.server_started_at,
          nowMs: nowMs(),
        }), duration);
        await djPause(currentPosition);
        updatePlaybackToggle(false);
      } else if (!state.current_track_id && currentTracks[0]) {
        await djSetTrack(currentTracks[0].id);
        updatePlaybackToggle(true);
      } else {
        // 저장된 시작 위치가 곡 끝(이후)이면 그 지점에서 재생을 재개할 수 없다.
        // 그대로 재개하면 즉시 종료되고 종료 처리가 다시 상태를 써서 루프가 된다.
        const duration = getLoadedDuration();
        const resumeAt = clampPositionToDuration(state.position_at_start, duration);
        await djPlay(duration > 0 && resumeAt >= duration - 0.5 ? 0 : resumeAt);
        updatePlaybackToggle(true);
      }
    });
    document.getElementById("prev-button")?.addEventListener("click", async () => {
      const state = await fetchPlaybackState();
      const currentPosition = clampPositionToDuration(computeExpectedPosition({
        isPlaying: state.is_playing,
        positionAtStart: state.position_at_start,
        serverStartedAt: state.server_started_at,
        nowMs: nowMs(),
      }), getLoadedDuration());
      const decision = computePrevTrackAction({
        tracks: currentTracks,
        currentTrackId: state.current_track_id,
        currentPosition,
        isPlaying: state.is_playing,
      });

      if (decision.action === "prev_track") {
        await djSetTrack(decision.trackId);
        updatePlaybackToggle(true);
      } else if (decision.action === "restart") {
        if (decision.isPlaying) {
          await djPlay(0);
          updatePlaybackToggle(true);
        } else {
          await djPause(0);
          updatePlaybackToggle(false);
        }
      }
    });
    document.getElementById("next-button").addEventListener("click", async () => {
      const state = await fetchPlaybackState();
      const currentIndex = currentTracks.findIndex((t) => t.id === state.current_track_id);
      const next = currentTracks[currentIndex + 1];
      if (next) {
        await djSetTrack(next.id);
      } else if (repeatMode === "all" && currentTracks.length > 0) {
        await djSetTrack(currentTracks[0].id);
      }
    });
    document.getElementById("repeat-button")?.addEventListener("click", () => {
      repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
      localStorage.setItem("sugar_dj_repeat", repeatMode);
      updateRepeatButtonUI();
    });
  }

  if (amDj) {
    enableDjControls();
  }
}

bootstrap().catch((err) => {
  console.error(err);
  document.getElementById("nickname-modal")?.classList.add("hidden");
  document.getElementById("listen-gate")?.classList.add("hidden");
  const app = document.getElementById("app");
  app?.classList.remove("hidden");
  if (app) {
    app.innerHTML = `
      <section class="panel startup-error" role="alert">
        <span class="empty-state-icon" aria-hidden="true">!</span>
        <h1>음악방에 연결하지 못했어요</h1>
        <p>네트워크 연결을 확인한 뒤 페이지를 새로고침해 주세요.</p>
        <button class="button button-primary" type="button" onclick="location.reload()">새로고침</button>
      </section>
    `;
  }
});
