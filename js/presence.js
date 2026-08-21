import { supabase } from "./supabaseClient.js";

export function initPresence({ roomId, uid, nickname, getVolume, onSync }) {
  const channel = supabase.channel(`room-presence-${roomId}`, {
    config: { presence: { key: uid } },
  });

  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState();
    const users = Object.values(state).map((entries) => entries[0]);
    onSync(users);
  });

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      const vol = getVolume ? getVolume() : { value: 100, muted: false };
      await channel.track({ uid, nickname, volume: vol.value, muted: vol.muted });
    }
  });

  return channel;
}
