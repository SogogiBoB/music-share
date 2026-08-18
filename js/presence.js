import { supabase } from "./supabaseClient.js";

export function initPresence({ uid, nickname, onSync }) {
  const channel = supabase.channel("room-presence", {
    config: { presence: { key: uid } },
  });

  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState();
    const users = Object.values(state).map((entries) => entries[0]);
    onSync(users);
  });

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel.track({ uid, nickname });
    }
  });

  return channel;
}
