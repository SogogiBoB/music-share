import { addTrackFromLibrary } from "./playlist.js";
import {
  fetchAllPlaylistsWithTracks, createPlaylist, renamePlaylist, deletePlaylist,
  removeTrackFromPlaylist, moveTrackToPlaylist,
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

export function initPlaylistUI({ ownerUid, amDj = false, uid = ownerUid }) {
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
    playlists.forEach((p, index) => {
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

      const bk = document.createElement("span");
      bk.className = "bk";
      bk.textContent = String.fromCharCode(97 + index);

      const bn = document.createElement("span");
      bn.className = "bn";
      bn.textContent = p.name;

      const bc = document.createElement("span");
      bc.className = "bc";
      bc.textContent = String(p.tracks.length);

      btn.append(bk, bn, bc);

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

  function renderMoveDropdown(track) {
    const select = document.createElement("select");
    select.className = "move";
    const placeholder = document.createElement("option");
    placeholder.textContent = "다른 재생목록으로 이동";
    placeholder.value = "";
    select.appendChild(placeholder);
    for (const p of playlists) {
      if (p.id === selectedPlaylistId) continue;
      const opt = document.createElement("option");
      opt.value = String(p.id);
      opt.textContent = p.name;
      select.appendChild(opt);
    }
    select.addEventListener("change", async () => {
      const targetId = Number(select.value);
      if (!targetId) return;
      try {
        await moveTrackToPlaylist({ trackId: track.id, targetPlaylistId: targetId });
        await reload();
      } catch (err) {
        setStatus(err.message ?? "이동하지 못했어요.", true);
        select.value = "";
      }
    });
    return select;
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

      const number = document.createElement("span");
      number.className = "no";
      number.textContent = String(index + 1).padStart(2, "0");

      const title = document.createElement("span");
      title.className = "tt";
      title.textContent = t.title;

      const del = document.createElement("button");
      del.type = "button";
      del.className = "rm";
      del.textContent = "×";
      del.addEventListener("click", async () => {
        try {
          await removeTrackFromPlaylist(t.id);
          await reload();
        } catch (err) {
          console.error(err);
          setStatus("삭제하지 못했어요.", true);
        }
      });

      const elements = [number, title, renderMoveDropdown(t)];
      if (amDj) {
        const toQueue = document.createElement("button");
        toQueue.className = "key to-room";
        toQueue.type = "button";
        toQueue.textContent = "＋ 대기열";
        toQueue.addEventListener("click", async () => {
          toQueue.disabled = true;
          try {
            await addTrackFromLibrary({ youtubeId: t.youtube_id, title: t.title, uid: uid ?? ownerUid });
            toQueue.textContent = "대기열에 넣었어요";
          } catch (err) {
            console.error(err);
            setStatus(err.message ?? "대기열에 넣지 못했어요.", true);
          } finally {
            toQueue.disabled = false;
            setTimeout(() => { toQueue.textContent = "＋ 대기열"; }, 1500);
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
