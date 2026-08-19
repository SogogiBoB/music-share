import { parseYoutubeId, fetchYoutubeTitle, addTrackFromLibrary } from "./playlist.js";
import { searchYoutube } from "./youtubeSearch.js";
import {
  fetchAllPlaylistsWithTracks, createPlaylist, renamePlaylist, deletePlaylist,
  addTrackToPlaylist, removeTrackFromPlaylist, moveTrackToPlaylist,
  computeReorderedPositions, persistReorder, filterPlaylistsByQuery,
} from "./playlists.js";

export function initPlaylistUI({ ownerUid, amDj = false, uid = ownerUid }) {
  let playlists = [];
  let selectedPlaylistId = null;
  let searchQuery = "";

  const statusEl = document.getElementById("playlist-manager-status");

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle("is-error", isError);
  }

  function visiblePlaylists() {
    return filterPlaylistsByQuery(playlists, searchQuery);
  }

  function renderPlaylistList() {
    const list = document.getElementById("playlist-list");
    list.innerHTML = "";
    const visible = visiblePlaylists();
    visible.forEach((p, index) => {
      const li = document.createElement("li");
      li.className = "bank-item";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bank";
      if (p.id === selectedPlaylistId) btn.classList.add("is-on");

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

      btn.addEventListener("click", () => {
        selectedPlaylistId = p.id;
        renderPlaylistList();
        renderDetail();
      });
      li.appendChild(btn);

      const acts = document.createElement("div");
      acts.className = "bank-acts";

      const rename = document.createElement("button");
      rename.type = "button";
      rename.textContent = "이름변경";
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
      del.textContent = "삭제";
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

      li.appendChild(acts);
      list.appendChild(li);
    });
  }

  function currentPlaylist() {
    return playlists.find((p) => p.id === selectedPlaylistId) ?? null;
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

  function renderDetail() {
    const empty = document.getElementById("playlist-detail-empty");
    const content = document.getElementById("playlist-detail-content");
    const playlist = currentPlaylist();

    empty.classList.toggle("hidden", Boolean(playlist));
    content.classList.toggle("hidden", !playlist);
    if (!playlist) return;

    document.getElementById("playlist-detail-name").textContent = playlist.name;

    const list = document.getElementById("playlist-track-list");
    list.innerHTML = "";
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
        renderDetail();
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
            toQueue.textContent = "대기열에 있음";
          } catch (err) {
            toQueue.textContent = "대기열에 있음";
          }
        });
        elements.push(toQueue);
      }
      elements.push(del);

      li.append(...elements);
      list.appendChild(li);
    });

    let djHint = document.getElementById("playlist-dj-hint");
    if (!djHint) {
      djHint = document.createElement("p");
      djHint.id = "playlist-dj-hint";
      djHint.className = "dj-hint field-message";
      list.after(djHint);
    }
    djHint.textContent = "DJ가 되면 이 목록의 곡을 바로 대기열에 넣을 수 있어요.";
    djHint.classList.toggle("hidden", Boolean(amDj));
  }

  async function reload() {
    playlists = await fetchAllPlaylistsWithTracks(ownerUid);
    renderPlaylistList();
    renderDetail();
  }

  document.getElementById("new-playlist-button").addEventListener("click", async () => {
    const input = document.getElementById("new-playlist-name-input");
    const name = input.value.trim();
    if (!name) {
      setStatus("재생목록 이름을 입력해 주세요.", true);
      return;
    }
    try {
      await createPlaylist({ name, ownerUid });
      input.value = "";
      setStatus("");
      await reload();
    } catch (err) {
      console.error(err);
      setStatus("재생목록을 만들지 못했어요.", true);
    }
  });

  document.getElementById("playlist-search-button").addEventListener("click", () => {
    searchQuery = document.getElementById("playlist-search-input").value;
    renderPlaylistList();
  });
  document.getElementById("playlist-search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("playlist-search-button").click();
  });

  const trackStatus = document.getElementById("playlist-track-status");

  document.getElementById("playlist-track-url-button").addEventListener("click", async () => {
    const playlist = currentPlaylist();
    if (!playlist) return;
    const input = document.getElementById("playlist-track-url-input");
    const url = input.value.trim();
    const videoId = parseYoutubeId(url);
    if (!videoId) {
      trackStatus.textContent = "올바른 유튜브 링크를 입력해 주세요.";
      trackStatus.classList.add("is-error");
      return;
    }
    trackStatus.classList.remove("is-error");
    trackStatus.textContent = "곡 정보를 확인하고 있어요.";
    try {
      const title = await fetchYoutubeTitle(videoId);
      await addTrackToPlaylist({ playlistId: playlist.id, youtubeId: videoId, title });
      input.value = "";
      trackStatus.textContent = "추가했어요.";
      await reload();
    } catch (err) {
      trackStatus.classList.add("is-error");
      trackStatus.textContent = err.message ?? "추가하지 못했어요.";
    }
  });

  document.getElementById("playlist-track-search-button").addEventListener("click", async () => {
    const query = document.getElementById("playlist-track-search-input").value.trim();
    const resultsList = document.getElementById("playlist-track-search-results");
    resultsList.innerHTML = "";
    if (!query) return;
    trackStatus.classList.remove("is-error");
    trackStatus.textContent = "검색하는 중…";
    try {
      const results = await searchYoutube(query);
      trackStatus.textContent = results.length ? "" : "검색 결과가 없어요.";
      for (const r of results) {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "youtube-search-result-button";
        btn.textContent = r.title;
        btn.addEventListener("click", async () => {
          const playlist = currentPlaylist();
          if (!playlist) return;
          try {
            await addTrackToPlaylist({ playlistId: playlist.id, youtubeId: r.videoId, title: r.title });
            trackStatus.classList.remove("is-error");
            trackStatus.textContent = "추가했어요.";
            await reload();
          } catch (err) {
            trackStatus.classList.add("is-error");
            trackStatus.textContent = err.message ?? "추가하지 못했어요.";
          }
        });
        li.appendChild(btn);
        resultsList.appendChild(li);
      }
    } catch (err) {
      console.error(err);
      trackStatus.classList.add("is-error");
      trackStatus.textContent = "유튜브 검색에 실패했어요.";
    }
  });

  reload().catch((err) => {
    console.error(err);
    setStatus("재생목록을 불러오지 못했어요.", true);
  });
}
