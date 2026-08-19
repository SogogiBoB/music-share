import { supabase } from "./supabaseClient.js";

const STORAGE_KEY = "sugardj.myVolume";

export function clampVolume(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(0, n));
}

export function computeOutputVolume({ master, mine, masterMuted = false, myMuted = false }) {
  if (masterMuted || myMuted) return 0;
  return Math.round((clampVolume(master) * clampVolume(mine)) / 100);
}

export function loadMyVolume() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "");
    return { value: clampVolume(raw.value), muted: Boolean(raw.muted) };
  } catch {
    return { value: 100, muted: false };
  }
}

export function saveMyVolume({ value, muted }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ value: clampVolume(value), muted: Boolean(muted) }));
}

export async function setMasterVolume(value) {
  const { data, error } = await supabase.rpc("set_master_volume", { v: clampVolume(value) });
  if (error) throw error;
  return data === true;
}
