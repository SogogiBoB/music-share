import { supabase } from "./supabaseClient.js";

export async function claimDjIfVacant(_uid) {
  const { data, error } = await supabase.rpc("claim_dj");
  if (error) throw error;
  return data === true;
}

export async function delegateDj(targetUid) {
  const { data, error } = await supabase.rpc("delegate_dj", { target_uid: targetUid });
  if (error) throw error;
  return data === true;
}

export async function releaseDj() {
  const { data, error } = await supabase.rpc("release_dj");
  if (error) throw error;
  return data === true;
}

// presence 메타데이터의 닉네임은 클라이언트가 자유롭게 조작할 수 있다.
// profiles 는 "본인 프로필만 생성/수정" RLS 로 uid 소유자만 쓸 수 있으므로
// 표시용 닉네임은 이쪽을 신뢰한다.
export async function fetchProfiles() {
  const { data, error } = await supabase.from("profiles").select();
  if (error) throw error;
  return data;
}

export function subscribeSettings(onChange) {
  return supabase
    .channel("settings-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, onChange)
    .subscribe();
}

export function isCurrentDj(settingsRow, uid) {
  return settingsRow?.dj_uid === uid;
}

export async function fetchSettings() {
  const { data, error } = await supabase.from("settings").select().eq("id", 1).single();
  if (error) throw error;
  return data;
}
