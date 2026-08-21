import { supabase } from "./supabaseClient.js";

// presence 메타데이터의 닉네임은 클라이언트가 자유롭게 조작할 수 있다.
// profiles 는 "본인 프로필만 생성/수정" RLS 로 uid 소유자만 쓸 수 있으므로
// 표시용 닉네임은 이쪽을 신뢰한다.
export async function fetchProfiles() {
  const { data, error } = await supabase.from("profiles").select();
  if (error) throw error;
  return data;
}

// DJ 는 방을 만든 사람으로 고정이다. 임대·양도·회수 개념이 없다.
export function isRoomOwner(room, uid) {
  return Boolean(room && uid && room.owner_uid === uid);
}

export function getRoomViewState({ room, uid, isGuest }) {
  const amDj = isRoomOwner(room, uid);
  return {
    amDj,
    isGuest: Boolean(isGuest),
    showQueuePanel: amDj,
    showTransport: amDj,
    showLibraryTab: !isGuest,
  };
}

export function getRoomStatusText({ amDj, isGuest }) {
  if (amDj) return "내가 방장입니다";
  if (isGuest) return "게스트로 듣는 중이에요";
  return "방장이 음악을 고르고 있어요";
}
