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

export function isCurrentDj(settingsRow, uid) {
  return settingsRow?.dj_uid === uid;
}

export async function fetchSettings() {
  const { data, error } = await supabase.from("settings").select().eq("id", 1).single();
  if (error) throw error;
  return data;
}
