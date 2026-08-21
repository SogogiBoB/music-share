import { ensureIdentity, signOut } from "./auth.js";
import {
  listRooms, createRoom, joinRoom, deleteRoom, roomUrl,
  validateRoomName, getRoomListViewState, canDeleteRoom, formatRoomMeta,
} from "./rooms.js";

const ICON_LOCK = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
  <rect x="5" y="10.5" width="14" height="9" rx="1.5"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/>
</svg>`;

function setModalOpen(modal, open) {
  modal.classList.toggle("hidden", !open);
}

function enterRoom(roomId) {
  location.href = roomUrl(roomId);
}

async function bootstrap() {
  const identity = await ensureIdentity();
  const view = getRoomListViewState({ isGuest: identity.isGuest });

  document.getElementById("rooms-app").classList.remove("hidden");
  document.getElementById("rooms-identity").textContent =
    `${identity.nickname}님 · ${identity.isGuest ? "게스트" : "회원"}`;
  document.getElementById("new-room-button").classList.toggle("hidden", !view.showCreateButton);

  const listEl = document.getElementById("rooms-list");
  const statusEl = document.getElementById("rooms-status");
  const countEl = document.getElementById("rooms-count");

  function setStatus(text, kind = "") {
    statusEl.className = kind ? `note ${kind}` : "note";
    statusEl.textContent = text;
  }

  // ── 비밀번호 입력 모달 ──────────────────────────────────
  const pwModal = document.getElementById("room-password-modal");
  const pwInput = document.getElementById("room-password-input");
  const pwStatus = document.getElementById("room-password-status");
  const pwSubmit = document.getElementById("room-password-submit");
  let pwTargetRoom = null;

  function closePasswordModal() {
    pwTargetRoom = null;
    pwInput.value = "";
    setModalOpen(pwModal, false);
  }

  function openPasswordModal(room) {
    pwTargetRoom = room;
    pwInput.value = "";
    pwStatus.className = "note";
    pwStatus.textContent = "";
    document.getElementById("room-password-name").textContent = room.name;
    setModalOpen(pwModal, true);
    pwInput.focus();
  }

  pwSubmit.addEventListener("click", async () => {
    if (!pwTargetRoom) return;
    pwSubmit.disabled = true;
    pwStatus.className = "note";
    pwStatus.textContent = "입장하는 중…";
    try {
      const ok = await joinRoom({ roomId: pwTargetRoom.id, password: pwInput.value });
      if (!ok) {
        pwStatus.className = "note err";
        pwStatus.textContent = "비밀번호가 맞지 않아요.";
        return;
      }
      enterRoom(pwTargetRoom.id);
    } catch (err) {
      console.error(err);
      pwStatus.className = "note err";
      pwStatus.textContent = "입장하지 못했어요. 잠시 후 다시 시도해 주세요.";
    } finally {
      pwSubmit.disabled = false;
    }
  });
  pwInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pwSubmit.click();
  });
  document.getElementById("room-password-cancel").addEventListener("click", closePasswordModal);
  pwModal.addEventListener("click", (e) => {
    if (e.target === pwModal) closePasswordModal();
  });

  // 잠긴 방이라도 이미 멤버면 비밀번호 없이 통과한다(join_room 이 멤버십을 먼저 본다).
  // 그래서 항상 비번 없이 한 번 시도해 보고, 거절당했을 때만 입력을 받는다.
  async function tryEnter(room, button) {
    button.disabled = true;
    setStatus("입장하는 중…");
    try {
      const ok = await joinRoom({ roomId: room.id });
      if (ok) {
        enterRoom(room.id);
        return;
      }
      setStatus("");
      openPasswordModal(room);
    } catch (err) {
      console.error(err);
      setStatus("입장하지 못했어요. 잠시 후 다시 시도해 주세요.", "err");
    } finally {
      button.disabled = false;
    }
  }

  async function removeRoom(room, button) {
    if (!confirm(`"${room.name}" 방을 삭제할까요? 대기열도 함께 사라집니다.`)) return;
    button.disabled = true;
    try {
      const ok = await deleteRoom(room.id);
      if (!ok) {
        setStatus("방을 삭제하지 못했어요.", "err");
        return;
      }
      setStatus("방을 삭제했어요.", "ok");
      await refresh();
    } catch (err) {
      console.error(err);
      setStatus("방을 삭제하지 못했어요.", "err");
    } finally {
      button.disabled = false;
    }
  }

  function renderRooms(rooms) {
    countEl.textContent = String(rooms.length).padStart(2, "0");
    listEl.innerHTML = "";

    if (!rooms.length) {
      const li = document.createElement("li");
      li.className = "room-empty";
      li.textContent = view.showCreateButton
        ? "아직 방이 없어요. 첫 방을 만들어 보세요."
        : "아직 열린 방이 없어요. 잠시 후 다시 확인해 주세요.";
      listEl.appendChild(li);
      return;
    }

    for (const room of rooms) {
      const li = document.createElement("li");
      li.className = "room-row";

      const info = document.createElement("div");
      info.className = "room-info";

      const nameRow = document.createElement("div");
      nameRow.className = "room-name";
      if (room.has_password) {
        const lock = document.createElement("span");
        lock.className = "room-lock";
        lock.title = "비밀번호가 걸린 방";
        lock.setAttribute("aria-label", "비밀번호가 걸린 방");
        lock.innerHTML = ICON_LOCK;
        nameRow.appendChild(lock);
      }
      const name = document.createElement("span");
      name.className = "nm";
      name.textContent = room.name;
      nameRow.appendChild(name);

      const meta = document.createElement("p");
      meta.className = "room-meta";
      meta.textContent = formatRoomMeta(room);

      info.append(nameRow, meta);

      const enter = document.createElement("button");
      enter.type = "button";
      enter.className = "key key-on";
      enter.textContent = "입장";
      enter.setAttribute("aria-label", `${room.name} 방 입장`);
      enter.addEventListener("click", () => tryEnter(room, enter));

      li.append(info, enter);

      if (canDeleteRoom(room, identity.uid)) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "key";
        del.textContent = "삭제";
        del.setAttribute("aria-label", `${room.name} 방 삭제`);
        del.addEventListener("click", () => removeRoom(room, del));
        li.appendChild(del);
      }

      listEl.appendChild(li);
    }
  }

  async function refresh() {
    try {
      renderRooms(await listRooms());
    } catch (err) {
      console.error(err);
      setStatus("방 목록을 불러오지 못했어요. 새로고침해 주세요.", "err");
    }
  }

  // ── 방 만들기 모달 ──────────────────────────────────────
  const newModal = document.getElementById("new-room-modal");
  const newName = document.getElementById("new-room-name-input");
  const newPassword = document.getElementById("new-room-password-input");
  const newStatus = document.getElementById("new-room-status");
  const newSubmit = document.getElementById("new-room-submit");

  function closeNewRoomModal() {
    newName.value = "";
    newPassword.value = "";
    newStatus.className = "note";
    newStatus.textContent = "";
    setModalOpen(newModal, false);
  }

  document.getElementById("new-room-button").addEventListener("click", () => {
    setModalOpen(newModal, true);
    newName.focus();
  });
  document.getElementById("new-room-cancel").addEventListener("click", closeNewRoomModal);
  newModal.addEventListener("click", (e) => {
    if (e.target === newModal) closeNewRoomModal();
  });

  newSubmit.addEventListener("click", async () => {
    const name = validateRoomName(newName.value);
    if (name.message) {
      newStatus.className = "note err";
      newStatus.textContent = name.message;
      newName.focus();
      return;
    }
    newSubmit.disabled = true;
    newStatus.className = "note";
    newStatus.textContent = "방을 만드는 중…";
    try {
      const roomId = await createRoom({ name: name.value, password: newPassword.value });
      enterRoom(roomId);
    } catch (err) {
      console.error(err);
      newStatus.className = "note err";
      newStatus.textContent = err.message ?? "방을 만들지 못했어요.";
    } finally {
      newSubmit.disabled = false;
    }
  });
  newName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") newPassword.focus();
  });
  newPassword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") newSubmit.click();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!pwModal.classList.contains("hidden")) closePasswordModal();
    else if (!newModal.classList.contains("hidden")) closeNewRoomModal();
  });

  document.getElementById("rooms-refresh").addEventListener("click", () => {
    setStatus("");
    refresh();
  });
  document.getElementById("rooms-logout").addEventListener("click", async () => {
    await signOut();
    location.reload();
  });

  await refresh();
}

bootstrap().catch((err) => {
  console.error(err);
  document.getElementById("nickname-modal")?.classList.add("hidden");
  const app = document.getElementById("rooms-app");
  app?.classList.remove("hidden");
  if (app) {
    app.innerHTML = `
      <section class="panel startup-error" role="alert">
        <span class="empty-state-icon" aria-hidden="true">!</span>
        <h1>방 목록을 불러오지 못했어요</h1>
        <p>네트워크 연결을 확인한 뒤 페이지를 새로고침해 주세요.</p>
        <button class="button button-primary" type="button" onclick="location.reload()">새로고침</button>
      </section>
    `;
  }
});
