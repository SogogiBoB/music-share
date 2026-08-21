import { supabase } from "./supabaseClient.js";

const MAX_ROOM_NAME_LENGTH = 30;

export function validateRoomName(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) return { value, message: "방 이름을 입력해 주세요." };
  if (value.length > MAX_ROOM_NAME_LENGTH) {
    return { value, message: `방 이름은 ${MAX_ROOM_NAME_LENGTH}자 이하로 지어 주세요.` };
  }
  return { value, message: "" };
}

// 비밀번호는 선택 사항이다. 공백만 입력한 경우는 "잠그지 않음"으로 본다.
export function normalizeRoomPassword(rawValue) {
  const value = String(rawValue ?? "");
  return value.trim() ? value : null;
}

export function getRoomListViewState({ isGuest } = {}) {
  return { showCreateButton: !isGuest };
}

export function canDeleteRoom(room, uid) {
  return Boolean(room && uid && room.owner_uid === uid);
}

// 방 id 는 해시(`#room=12`)로 나른다. `npx serve` 같은 clean-URL 서버는
// /index.html?room=12 를 /index 로 301 하면서 쿼리스트링을 버리는데, 해시는
// 애초에 서버로 전송되지 않아 리다이렉트를 그대로 통과한다.
// 예전 형태(`?room=12`)로 저장해 둔 링크도 계속 열리도록 쿼리도 함께 읽는다.
export function parseRoomId({ search = "", hash = "" } = {}) {
  const raw = new URLSearchParams(String(hash).replace(/^#/, "")).get("room")
    ?? new URLSearchParams(String(search)).get("room");
  if (raw === null) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function roomUrl(roomId) {
  return `index.html#room=${roomId}`;
}

export function formatRoomMeta({ owner_nickname, member_count } = {}) {
  const owner = owner_nickname || "알 수 없음";
  const count = Number(member_count) || 0;
  return `방장 ${owner} · ${count}명`;
}

export async function listRooms() {
  const { data, error } = await supabase.rpc("list_rooms");
  if (error) throw error;
  return data ?? [];
}

export async function createRoom({ name, password }) {
  const { data, error } = await supabase.rpc("create_room", {
    p_name: name,
    p_password: normalizeRoomPassword(password),
  });
  if (error) throw error;
  return data;
}

// 비밀번호가 틀리면 예외가 아니라 false 가 온다(잘못된 비번과 서버 오류를 구분하기 위해).
export async function joinRoom({ roomId, password = null }) {
  const { data, error } = await supabase.rpc("join_room", {
    p_room_id: roomId,
    p_password: normalizeRoomPassword(password),
  });
  if (error) throw error;
  return data === true;
}

export async function leaveRoom(roomId) {
  const { data, error } = await supabase.rpc("leave_room", { p_room_id: roomId });
  if (error) throw error;
  return data === true;
}

export async function deleteRoom(roomId) {
  const { data, error } = await supabase.rpc("delete_room", { p_room_id: roomId });
  if (error) throw error;
  return data === true;
}

// 방 상세(이름·방장·마스터 볼륨). 비밀번호 해시는 별도 테이블이라 여기로 새지 않는다.
export async function fetchRoom(roomId) {
  const { data, error } = await supabase.from("rooms").select().eq("id", roomId).single();
  if (error) throw error;
  return data;
}

export function subscribeRoom(roomId, onChange) {
  return supabase
    .channel(`room-${roomId}-changes`)
    .on("postgres_changes", {
      event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}`,
    }, onChange)
    .subscribe();
}
