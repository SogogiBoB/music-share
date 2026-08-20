import { ensureIdentity, signOut } from "./auth.js";
import { initPlaylistUI } from "./playlistUI.js";
import {
  takeOverDj, fetchSettings, isCurrentDj,
  releaseDj, heartbeatDj, fetchProfiles, subscribeSettings, isDjLeaseExpired, shouldNotifyDjTakeover,
  getRoomViewState,
} from "./roles.js";
import { initPresence } from "./presence.js";
import { fetchTracks, subscribeTracks, deleteTrack, addTrackFromLibrary } from "./playlist.js";
import { searchUnified } from "./youtubeSearch.js";
import {
  fetchPlaylists, addTrackToPlaylist, getSaveToPlaylistState,
} from "./playlists.js";
import {
  unlockAudio, fetchPlaybackState, subscribePlaybackState, applyPlaybackState,
  djSetTrack, djPlay, djPause, startDriftCorrection, waitForPlayerReady, getPlaybackTogglePresentation,
  startClockOffsetSync, startProgressBarUpdates, applyOutputVolume, formatClock,
  computeExpectedPosition, computePrevTrackAction, computeNextTrackOnEnded, setPlayerStateChangeHandler,
  syncClockOffset, nowMs, clampPositionToDuration, getLoadedDuration,
} from "./player.js";
import { computeOutputVolume, clampVolume, loadMyVolume, saveMyVolume, setMasterVolume } from "./volume.js";

// 목록에 담기 아이콘. 검색 결과 오른쪽의 "내 재생목록에 추가" 버튼에 쓴다.
const ICON_LIST_ADD = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M4 7h12M4 12h9M4 17h7"/><path d="M17.5 13v7M14 16.5h7"/>
</svg>`;

// 곡 제목이 브라운관 폭보다 길면 재생 중에만 왼쪽으로 흘려서 뒷부분까지 보여준다.
// 넘치는 폭(--marq-shift)과 이동 시간(--marq-dur)은 실제 렌더 크기로 계산한다.
const MARQUEE_SPEED_PX_PER_SEC = 55;

function updateTitleMarquee() {
  const nowTitle = document.getElementById("now-title");
  const inner = nowTitle?.querySelector(".marq");
  if (!inner) return;

  nowTitle.classList.remove("is-marquee");
  const overflow = inner.scrollWidth - nowTitle.clientWidth;
  if (overflow <= 4) return;

  // 양끝에서 잠깐 멈추므로 왕복 시간에 여유(2.4초)를 더한다.
  const travel = (overflow / MARQUEE_SPEED_PX_PER_SEC) * 2 + 2.4;
  nowTitle.style.setProperty("--marq-shift", `${-overflow}px`);
  nowTitle.style.setProperty("--marq-dur", `${travel.toFixed(1)}s`);
  nowTitle.classList.add("is-marquee");
}

function renderNowPlaying(tracks, currentTrackId) {
  const track = tracks.find((t) => t.id === currentTrackId);
  const nowTitle = document.getElementById("now-title");
  const nowSub = document.getElementById("now-sub");
  if (nowTitle) {
    const inner = document.createElement("span");
    inner.className = "marq";
    inner.textContent = track ? track.title : "—";
    nowTitle.replaceChildren(inner);
    requestAnimationFrame(updateTitleMarquee);
  }
  if (nowSub) {
    nowSub.textContent = track
      ? "모두 같은 지점에서 듣는 중"
      : "DJ가 곡을 고르는 중이에요";
  }
}

// 참여자는 닉네임만 보여준다(역할·DJ 램프·위임 버튼 없음).
// 인원수는 상단 레일 배지와 팝업 헤더 둘 다에 쓴다.
function renderPresence(users, profiles) {
  const list = document.getElementById("presence-list");
  for (const id of ["presence-count", "presence-modal-count"]) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(users.length);
  }
  if (!list) return;
  list.innerHTML = "";
  for (const u of users) {
    const profile = profiles[u.uid];
    const nickname = String(profile?.nickname ?? u.nickname ?? "게스트");

    const li = document.createElement("li");
    li.className = "preset";

    const name = document.createElement("span");
    name.className = "nm";
    name.textContent = nickname;
    li.append(name);

    list.appendChild(li);
  }
}

function renderTracks(tracks, amDj, currentTrackId, saveToPlaylist = null) {
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
      <span>${amDj ? "위에서 링크나 곡 제목으로 검색해 첫 곡을 추가해 보세요." : "DJ가 곧 첫 곡을 골라 줄 거예요."}</span>
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

    // 대기열의 곡을 내 재생목록으로 담는다. 어느 목록에 넣을지는 모달에서 고른다.
    if (saveToPlaylist?.showButton) {
      const toLib = document.createElement("button");
      toLib.type = "button";
      toLib.className = "key to-lib";
      toLib.textContent = "플리로";
      toLib.setAttribute("aria-label", `${t.title} 내 재생목록에 저장`);
      toLib.addEventListener("click", (event) => {
        event.stopPropagation();
        saveToPlaylist.onRequest({ youtubeId: t.youtube_id, title: t.title });
      });
      li.appendChild(toLib);
    }

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
  // 라이브러리는 이제 탭이 아니라 방 화면 오른쪽 컬럼이다. 게스트에게는 컬럼째 감추고
  // 왼쪽(재생 + 대기열)이 화면 전체를 쓰게 한다.
  document.getElementById("library-section").classList.toggle("hidden", !view.showLibraryTab);
  document.getElementById("room-view").classList.toggle("is-solo", !view.showLibraryTab);
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
  const nowTitle = document.getElementById("now-title");
  if (nowTitle) {
    nowTitle.classList.toggle("is-playing", Boolean(isPlaying));
    if (isPlaying) updateTitleMarquee();
  }
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
  let currentView = renderRoomAccess(settings, identity);
  document.getElementById("app").classList.remove("hidden");

  let masterVolume = { value: settings.master_volume ?? 100, muted: false };
  let myVolume = loadMyVolume();

  function updateVolumeUI(containerId, value, muted, locked) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.classList.toggle("is-muted", muted);
    if (locked !== undefined) el.classList.toggle("is-locked", locked);
    // 슬라이더 트랙의 채워진 구간은 CSS 변수로 그린다.
    el.style.setProperty("--v", `${muted ? 0 : value}%`);
  }

  function renderVolume(view) {
    const out = computeOutputVolume({
      master: masterVolume.value, mine: myVolume.value,
      masterMuted: masterVolume.muted, myMuted: myVolume.muted,
    });
    applyOutputVolume(out);

    const masterInput = document.getElementById("master-volume-input");
    masterInput.value = masterVolume.value;
    masterInput.disabled = !view.amDj;
    masterInput.title = view.amDj ? "마스터 볼륨 · 방 전체 기준" : "마스터 볼륨 · DJ만 조절";
    document.getElementById("master-volume-mute").disabled = !view.amDj;
    document.getElementById("my-volume-input").value = myVolume.value;

    updateVolumeUI("master-volume", masterVolume.value, masterVolume.muted, !view.amDj);
    updateVolumeUI("my-volume", myVolume.value, myVolume.muted, false);
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

  // 재생목록 라이브러리는 탭이 아니라 방 화면 오른쪽에 상시 떠 있으므로 부팅 때 바로 켠다.
  const playlistUIHandle = initPlaylistUI({ ownerUid: identity.uid, amDj });

  // 참여자 목록: 상단 레일의 "N명 참여중" 을 누르면 팝업으로 연다.
  const presenceModal = document.getElementById("presence-modal");
  const presenceTrigger = document.getElementById("presence-open");
  function setPresenceModalOpen(open) {
    presenceModal.classList.toggle("hidden", !open);
    if (!open) presenceTrigger.focus();
  }
  presenceTrigger.addEventListener("click", () => setPresenceModalOpen(true));
  document.getElementById("presence-close").addEventListener("click", () => setPresenceModalOpen(false));
  presenceModal.addEventListener("click", (event) => {
    if (event.target === presenceModal) setPresenceModalOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !presenceModal.classList.contains("hidden")) setPresenceModalOpen(false);
  });

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
      renderPresence(users, profiles);
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
      currentView = renderRoomAccess(settings, identity);
      renderVolume(currentView);
      renderTracks(currentTracks, amDj, currentTrackId, saveToPlaylist);
      // DJ가 되면 이미 떠 있는 검색 결과에도 ＋(대기열) 버튼이 생겨야 한다.
      renderSearchResults(lastSearchResults);
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

  // 창 폭이 바뀌면 제목이 넘치는지 다시 재어 흐름 여부를 정한다.
  window.addEventListener("resize", updateTitleMarquee);

  if (amDj) startDjHeartbeat();

  // ── 대기열 곡 → 내 재생목록 저장 모달 ──────────────────────
  let myPlaylists = [];
  let saveTargetTrack = null;
  let selectedSavePlaylistId = null;

  const saveModal = document.getElementById("save-track-modal");
  const saveOptions = document.getElementById("save-track-options");
  const saveStatus = document.getElementById("save-track-status");
  const saveSubmit = document.getElementById("save-track-submit");

  function closeSaveModal() {
    saveTargetTrack = null;
    saveModal.classList.add("hidden");
  }

  function renderSaveOptions() {
    saveOptions.innerHTML = "";
    myPlaylists.forEach((p) => {
      const li = document.createElement("li");
      const label = document.createElement("label");
      label.className = "save-option";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "save-track-playlist";
      radio.value = String(p.id);
      radio.checked = String(p.id) === String(selectedSavePlaylistId);
      radio.addEventListener("change", () => {
        selectedSavePlaylistId = p.id;
      });
      const name = document.createElement("span");
      name.textContent = p.name;
      label.append(radio, name);
      li.appendChild(label);
      saveOptions.appendChild(li);
    });
  }

  async function openSaveModal(track) {
    saveTargetTrack = track;
    saveStatus.className = "note";
    saveStatus.textContent = "";
    document.getElementById("save-track-name").textContent = track.title;
    saveModal.classList.remove("hidden");

    try {
      myPlaylists = await fetchPlaylists(identity.uid);
    } catch (err) {
      console.error(err);
      myPlaylists = [];
    }
    const state = getSaveToPlaylistState({ isGuest: identity.isGuest, playlists: myPlaylists });
    if (!myPlaylists.some((p) => String(p.id) === String(selectedSavePlaylistId))) {
      selectedSavePlaylistId = myPlaylists[0]?.id ?? null;
    }
    renderSaveOptions();
    saveSubmit.disabled = !state.canSave;
    if (!state.canSave) {
      saveStatus.classList.add("err");
      saveStatus.textContent = state.message;
    }
  }

  saveSubmit.addEventListener("click", async () => {
    if (!saveTargetTrack || !selectedSavePlaylistId) return;
    saveSubmit.disabled = true;
    saveStatus.className = "note";
    saveStatus.textContent = "저장하는 중…";
    try {
      await addTrackToPlaylist({
        playlistId: Number(selectedSavePlaylistId),
        youtubeId: saveTargetTrack.youtubeId,
        title: saveTargetTrack.title,
      });
      closeSaveModal();
      setSearchStatus("내 재생목록에 저장했어요.", "ok");
      // 오른쪽 라이브러리에 저장분이 바로 보이도록 다시 읽는다.
      playlistUIHandle?.refresh();
    } catch (err) {
      saveStatus.classList.add("err");
      saveStatus.textContent = err.message ?? "저장하지 못했어요.";
    } finally {
      saveSubmit.disabled = false;
    }
  });
  document.getElementById("save-track-cancel").addEventListener("click", closeSaveModal);
  saveModal.addEventListener("click", (event) => {
    if (event.target === saveModal) closeSaveModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !saveModal.classList.contains("hidden")) closeSaveModal();
  });

  const saveToPlaylist = {
    showButton: !identity.isGuest,
    onRequest: (track) => openSaveModal(track).catch(console.error),
  };

  // 링크든 곡 제목이든 한 입력창에서 찾고, 결과 한 줄에서 바로 대기열(＋)이나
  // 내 재생목록(목록 아이콘 → 선택 모달)으로 보낸다.
  const searchInput = document.getElementById("track-search-input");
  const searchButton = document.getElementById("track-search-button");
  const searchResults = document.getElementById("track-search-results");
  const searchStatus = document.getElementById("track-search-status");
  let lastSearchResults = [];

  function setSearchStatus(text, kind = "") {
    searchStatus.className = kind ? `note ${kind}` : "note";
    searchStatus.textContent = text;
  }

  async function addResultToQueue(result, button) {
    button.disabled = true;
    setSearchStatus("대기열에 넣는 중…");
    try {
      await addTrackFromLibrary({ youtubeId: result.videoId, title: result.title, uid: identity.uid });
      setSearchStatus(`"${result.title}" 대기열에 추가했어요.`, "ok");
    } catch (err) {
      console.error(err);
      setSearchStatus(err.message ?? "대기열에 넣지 못했어요.", "err");
    } finally {
      button.disabled = false;
    }
  }

  function renderSearchResults(results) {
    lastSearchResults = results;
    searchResults.innerHTML = "";
    for (const r of results) {
      const li = document.createElement("li");
      li.className = "find";

      // 대기열에 넣는 건 DJ만 할 수 있으므로 DJ가 아닐 때는 ＋ 자체를 만들지 않는다.
      if (amDj) {
        const toQueue = document.createElement("button");
        toQueue.type = "button";
        toQueue.className = "find-btn";
        toQueue.title = "대기열에 추가";
        toQueue.setAttribute("aria-label", `${r.title} 대기열에 추가`);
        toQueue.textContent = "＋";
        toQueue.addEventListener("click", () => addResultToQueue(r, toQueue));
        li.appendChild(toQueue);
      }

      const title = document.createElement("span");
      title.className = "tt";
      title.textContent = r.title;
      li.appendChild(title);

      if (!identity.isGuest) {
        const toPlaylist = document.createElement("button");
        toPlaylist.type = "button";
        toPlaylist.className = "find-btn";
        toPlaylist.title = "내 재생목록에 추가";
        toPlaylist.setAttribute("aria-label", `${r.title} 내 재생목록에 추가`);
        toPlaylist.innerHTML = ICON_LIST_ADD;
        toPlaylist.addEventListener("click", () => {
          openSaveModal({ title: r.title, youtubeId: r.videoId }).catch(console.error);
        });
        li.appendChild(toPlaylist);
      }

      searchResults.appendChild(li);
    }
  }

  searchButton.addEventListener("click", async () => {
    searchResults.innerHTML = "";
    if (!searchInput.value.trim()) {
      setSearchStatus("유튜브 링크나 곡 제목을 입력해 주세요.", "err");
      searchInput.focus();
      return;
    }
    searchButton.disabled = true;
    searchButton.textContent = "찾는 중…";
    setSearchStatus("곡을 찾고 있어요.");
    try {
      const results = await searchUnified({ input: searchInput.value });
      setSearchStatus(results.length ? "" : "검색 결과가 없어요.");
      renderSearchResults(results);
    } catch (err) {
      console.error(err);
      setSearchStatus(err.message ?? "곡을 찾지 못했습니다. 잠시 후 다시 시도해 주세요.", "err");
    } finally {
      searchButton.disabled = false;
      searchButton.textContent = "검색";
    }
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchButton.click();
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

  renderTracks(currentTracks, amDj, currentTrackId, saveToPlaylist);
  renderNowPlaying(currentTracks, currentTrackId);
  subscribeTracks((tracks) => {
    currentTracks = tracks;
    renderTracks(tracks, amDj, currentTrackId, saveToPlaylist);
    renderNowPlaying(tracks, currentTrackId);
  });

  const applyState = async (state) => {
    const nextState = state ?? await fetchPlaybackState();
    updatePlaybackToggle(nextState.is_playing);
    if (nextState.current_track_id !== currentTrackId) {
      currentTrackId = nextState.current_track_id;
      renderTracks(currentTracks, amDj, currentTrackId, saveToPlaylist);
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
