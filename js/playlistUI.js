import { addTrackFromLibrary } from "./playlist.js";
import {
  fetchAllPlaylistsWithTracks, createPlaylist, renamePlaylist, deletePlaylist,
  removeTrackFromPlaylist, moveTrackToPlaylist, copyTrackToPlaylist,
  computeReorderedPositions, persistReorder,
} from "./playlists.js";

// 재생목록 한 줄 오른쪽에 붙는 아이콘 버튼(이름 변경 · 삭제).
const ICON_EDIT = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M4 20.5h4.2L19 9.7l-4.2-4.2L4 16.3z"/><path d="M13.7 6.6l4.2 4.2"/>
</svg>`;
const ICON_TRASH = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M4 6.5h16"/><path d="M9.5 6.5V3.8h5v2.7"/><path d="M6.3 6.5l1 13.7h9.4l1-13.7"/>
  <path d="M10.2 10.4v6.2M13.8 10.4v6.2"/>
</svg>`;

// 재생목록 곡 행 오른쪽에 붙는 아이콘 버튼(이동·복사, 대기열 추가, 완료).
const ICON_MOVE = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3 6h6l2 2h10v11a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 19z"/><path d="M10 14h5m-2.5-2.5 2.5 2.5-2.5 2.5"/>
</svg>`;
const ICON_TO_QUEUE = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M4 6h16M4 11h10M4 16h10"/><path d="M18 13.5v7M14.5 17h7"/>
</svg>`;
const ICON_CHECK = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M5 13l4 4L19 7"/>
</svg>`;

export function initPlaylistUI({ ownerUid, roomId, amDj = false, uid = ownerUid }) {
  let playlists = [];
  let selectedPlaylistId = null;

  const statusEl = document.getElementById("playlist-manager-status");

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle("is-error", isError);
  }

  function renderPlaylistList() {
    const list = document.getElementById("playlist-list");
    list.innerHTML = "";
    playlists.forEach((p) => {
      const isOpen = p.id === selectedPlaylistId;

      const li = document.createElement("li");
      li.className = "bank-item";
      if (isOpen) li.classList.add("is-open");

      const row = document.createElement("div");
      row.className = "bank-row";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bank";
      btn.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) btn.classList.add("is-on");

      const bn = document.createElement("span");
      bn.className = "bn";
      bn.textContent = p.name;

      const bc = document.createElement("span");
      bc.className = "bc";
      bc.textContent = String(p.tracks.length);

      btn.append(bn, bc);

      // 같은 목록을 다시 누르면 접는다.
      btn.addEventListener("click", () => {
        selectedPlaylistId = isOpen ? null : p.id;
        renderPlaylistList();
      });
      row.appendChild(btn);

      const acts = document.createElement("div");
      acts.className = "bank-acts";

      const rename = document.createElement("button");
      rename.type = "button";
      rename.title = "이름 변경";
      rename.setAttribute("aria-label", `${p.name} 이름 변경`);
      rename.innerHTML = ICON_EDIT;
      rename.addEventListener("click", async () => {
        const nextName = prompt("새 이름을 입력해 주세요.", p.name);
        if (!nextName || !nextName.trim()) return;
        try {
          await renamePlaylist(p.id, nextName.trim());
          await reload();
        } catch (err) {
          console.error(err);
          setStatus("이름을 바꾸지 못했어요.", true);
        }
      });
      acts.appendChild(rename);

      const del = document.createElement("button");
      del.type = "button";
      del.title = "삭제";
      del.setAttribute("aria-label", `${p.name} 삭제`);
      del.innerHTML = ICON_TRASH;
      del.addEventListener("click", async () => {
        if (!confirm(`"${p.name}" 재생목록을 삭제할까요?`)) return;
        try {
          await deletePlaylist(p.id);
          if (selectedPlaylistId === p.id) selectedPlaylistId = null;
          await reload();
        } catch (err) {
          console.error(err);
          setStatus("삭제하지 못했어요.", true);
        }
      });
      acts.appendChild(del);

      row.appendChild(acts);
      li.appendChild(row);

      // 아코디언: 펼친 목록만 곡 목록을 바로 아래에 그린다.
      if (isOpen) li.appendChild(renderTrackPanel(p));

      list.appendChild(li);
    });
  }

  // 다른 재생목록으로 보내기: 버튼 → 모달에서 대상 목록을 고르고 이동/복사를 누른다.
  function renderMoveButton(track, playlist) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "key move";
    btn.title = "다른 재생목록으로 이동·복사";
    btn.innerHTML = ICON_MOVE;
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-label", `${track.title} 다른 재생목록으로 이동하거나 복사`);
    btn.addEventListener("click", () => openMoveModal(track, playlist));
    return btn;
  }

  function renderTrackPanel(playlist) {
    const panel = document.createElement("div");
    panel.className = "bank-panel";

    const list = document.createElement("ul");
    list.className = "panel-tracks";
    list.setAttribute("aria-label", `${playlist.name} 곡 목록`);

    if (playlist.tracks.length === 0) {
      const emptyNote = document.createElement("p");
      emptyNote.className = "field-message";
      emptyNote.textContent = "아직 곡이 없어요. 위에서 곡을 찾아 담아 보세요.";
      panel.appendChild(emptyNote);
    }

    playlist.tracks.forEach((t, index) => {
      const li = document.createElement("li");
      li.className = "strip";
      li.draggable = true;
      li.dataset.trackId = t.id;

      li.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(index));
      });
      li.addEventListener("dragover", (e) => e.preventDefault());
      li.addEventListener("drop", async (e) => {
        e.preventDefault();
        const fromIndex = Number(e.dataTransfer.getData("text/plain"));
        const toIndex = index;
        if (fromIndex === toIndex) return;
        const reordered = computeReorderedPositions(playlist.tracks, fromIndex, toIndex);
        playlist.tracks = reordered;
        renderPlaylistList();
        try {
          await persistReorder(reordered);
        } catch (err) {
          console.error(err);
          setStatus("순서를 저장하지 못했어요.", true);
          await reload();
        }
      });

      const title = document.createElement("span");
      title.className = "tt";
      title.textContent = t.title;

      const del = document.createElement("button");
      del.type = "button";
      del.className = "rm";
      del.textContent = "×";
      del.title = "삭제";
      del.setAttribute("aria-label", `${t.title} 삭제`);
      del.addEventListener("click", async () => {
        try {
          await removeTrackFromPlaylist(t.id);
          await reload();
        } catch (err) {
          console.error(err);
          setStatus("삭제하지 못했어요.", true);
        }
      });

      const elements = [title, renderMoveButton(t, playlist)];
      if (amDj) {
        const toQueue = document.createElement("button");
        toQueue.className = "key to-room";
        toQueue.type = "button";
        toQueue.title = "대기열에 추가";
        toQueue.setAttribute("aria-label", `${t.title} 대기열에 추가`);
        toQueue.innerHTML = ICON_TO_QUEUE;
        toQueue.addEventListener("click", async () => {
          toQueue.disabled = true;
          try {
            await addTrackFromLibrary({ youtubeId: t.youtube_id, title: t.title, uid: uid ?? ownerUid, roomId });
            toQueue.innerHTML = ICON_CHECK;
            toQueue.title = "대기열에 넣었어요";
            setStatus(`"${t.title}" 대기열에 추가했어요.`);
          } catch (err) {
            console.error(err);
            setStatus(err.message ?? "대기열에 넣지 못했어요.", true);
          } finally {
            toQueue.disabled = false;
            setTimeout(() => {
              toQueue.innerHTML = ICON_TO_QUEUE;
              toQueue.title = "대기열에 추가";
            }, 1500);
          }
        });
        elements.push(toQueue);
      }
      elements.push(del);

      li.append(...elements);
      list.appendChild(li);
    });

    panel.appendChild(list);

    if (!amDj && playlist.tracks.length > 0) {
      const djHint = document.createElement("p");
      djHint.className = "dj-hint field-message";
      djHint.textContent = "DJ가 되면 이 목록의 곡을 바로 대기열에 넣을 수 있어요.";
      panel.appendChild(djHint);
    }

    return panel;
  }

  async function reload() {
    playlists = await fetchAllPlaylistsWithTracks(ownerUid);
    renderPlaylistList();
  }

  // 새 재생 목록: 목록 아래 고정 버튼 → 모달에서 이름을 받는다.
  const newModal = document.getElementById("new-playlist-modal");
  const newInput = document.getElementById("new-playlist-name-input");
  const newStatusEl = document.getElementById("new-playlist-status");
  const newSubmit = document.getElementById("new-playlist-submit");

  function openNewPlaylistModal() {
    newInput.value = "";
    newStatusEl.textContent = "";
    newStatusEl.classList.remove("is-error");
    newModal.classList.remove("hidden");
    newInput.focus();
  }

  function closeNewPlaylistModal() {
    newModal.classList.add("hidden");
    document.getElementById("new-playlist-button").focus();
  }

  async function submitNewPlaylist() {
    const name = newInput.value.trim();
    if (!name) {
      newStatusEl.textContent = "재생 목록 이름을 입력해 주세요.";
      newStatusEl.classList.add("is-error");
      newInput.focus();
      return;
    }
    newSubmit.disabled = true;
    try {
      await createPlaylist({ name, ownerUid });
      closeNewPlaylistModal();
      setStatus("");
      await reload();
    } catch (err) {
      console.error(err);
      newStatusEl.textContent = "재생 목록을 만들지 못했어요.";
      newStatusEl.classList.add("is-error");
    } finally {
      newSubmit.disabled = false;
    }
  }

  document.getElementById("new-playlist-button").addEventListener("click", openNewPlaylistModal);
  document.getElementById("new-playlist-cancel").addEventListener("click", closeNewPlaylistModal);
  newSubmit.addEventListener("click", submitNewPlaylist);
  newInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitNewPlaylist();
  });
  newModal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeNewPlaylistModal();
  });
  newModal.addEventListener("click", (e) => {
    if (e.target === newModal) closeNewPlaylistModal();
  });

  // 이동·복사 모달: 대상 재생목록을 라디오로 고르고, 이동/복사 버튼으로 동작을 정한다.
  const moveModal = document.getElementById("move-track-modal");
  const moveOptions = document.getElementById("move-track-options");
  const moveStatusEl = document.getElementById("move-track-status");
  const moveSubmit = document.getElementById("move-track-submit");
  const moveCopy = document.getElementById("move-track-copy");
  let moveTargetTrack = null;
  let moveSourcePlaylistId = null;
  let moveTargetPlaylistId = null;
  let moveOpener = null;

  function setMoveStatus(text, isError = false) {
    moveStatusEl.textContent = text;
    moveStatusEl.classList.toggle("is-error", isError);
  }

  function moveCandidates() {
    return playlists.filter((p) => String(p.id) !== String(moveSourcePlaylistId));
  }

  function renderMoveOptions() {
    moveOptions.innerHTML = "";
    for (const p of moveCandidates()) {
      const li = document.createElement("li");
      const label = document.createElement("label");
      label.className = "save-option";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "move-track-playlist";
      radio.value = String(p.id);
      radio.checked = String(p.id) === String(moveTargetPlaylistId);
      radio.addEventListener("change", () => { moveTargetPlaylistId = p.id; });
      const name = document.createElement("span");
      name.textContent = p.name;
      label.append(radio, name);
      li.appendChild(label);
      moveOptions.appendChild(li);
    }
  }

  function openMoveModal(track, playlist) {
    moveTargetTrack = track;
    moveSourcePlaylistId = playlist.id;
    moveOpener = document.activeElement;
    document.getElementById("move-track-name").textContent = track.title;

    const candidates = moveCandidates();
    moveTargetPlaylistId = candidates[0]?.id ?? null;
    renderMoveOptions();

    const canSend = candidates.length > 0;
    moveSubmit.disabled = !canSend;
    moveCopy.disabled = !canSend;
    setMoveStatus(canSend ? "" : "보낼 다른 재생목록이 없어요.", !canSend);

    moveModal.classList.remove("hidden");
    (moveOptions.querySelector("input") ?? moveSubmit).focus();
  }

  function closeMoveModal() {
    moveModal.classList.add("hidden");
    moveTargetTrack = null;
    moveSourcePlaylistId = null;
    moveOpener?.focus?.();
    moveOpener = null;
  }

  async function sendTrack(action) {
    if (!moveTargetTrack || !moveTargetPlaylistId) return;
    const isMove = action === "move";
    moveSubmit.disabled = true;
    moveCopy.disabled = true;
    setMoveStatus(isMove ? "옮기는 중…" : "복사하는 중…");
    try {
      const run = isMove ? moveTrackToPlaylist : copyTrackToPlaylist;
      await run({ trackId: moveTargetTrack.id, targetPlaylistId: Number(moveTargetPlaylistId) });
      closeMoveModal();
      setStatus(isMove ? "다른 재생목록으로 옮겼어요." : "다른 재생목록에 복사했어요.");
      await reload();
    } catch (err) {
      console.error(err);
      setMoveStatus(err.message ?? (isMove ? "이동하지 못했어요." : "복사하지 못했어요."), true);
    } finally {
      moveSubmit.disabled = false;
      moveCopy.disabled = false;
    }
  }

  moveSubmit.addEventListener("click", () => sendTrack("move"));
  moveCopy.addEventListener("click", () => sendTrack("copy"));
  document.getElementById("move-track-cancel").addEventListener("click", closeMoveModal);
  moveModal.addEventListener("click", (e) => {
    if (e.target === moveModal) closeMoveModal();
  });
  moveModal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMoveModal();
  });

  // 곡 검색·추가는 라이브러리 상단의 통합 검색(js/main.js)이 담당한다.

  function refresh() {
    return reload().catch((err) => {
      console.error(err);
      setStatus("재생목록을 불러오지 못했어요.", true);
    });
  }

  refresh();

  // 대기열 화면에서 곡을 저장했을 때처럼, 바깥에서 목록을 다시 읽어야 할 때 쓴다.
  return { refresh };
}
