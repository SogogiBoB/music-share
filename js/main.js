import { ensureIdentity } from "./auth.js";
import { claimDjIfVacant, fetchSettings, isCurrentDj } from "./roles.js";
import { initPresence } from "./presence.js";
import { delegateDj } from "./roles.js";

function renderPresence(users, myUid, djUid) {
  const list = document.getElementById("presence-list");
  list.innerHTML = "";
  for (const u of users) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = u.nickname + (u.uid === djUid ? "" : "");
    li.appendChild(label);
    if (u.uid === djUid) {
      const badge = document.createElement("span");
      badge.className = "badge-dj";
      badge.textContent = "DJ";
      li.appendChild(badge);
    }
    if (djUid === myUid && u.uid !== myUid) {
      const btn = document.createElement("button");
      btn.textContent = "DJ 위임";
      btn.addEventListener("click", async () => {
        await delegateDj(u.uid);
        location.reload();
      });
      li.appendChild(btn);
    }
    list.appendChild(li);
  }
}

async function bootstrap() {
  const identity = await ensureIdentity();
  await claimDjIfVacant(identity.uid);
  const settings = await fetchSettings();
  const amDj = isCurrentDj(settings, identity.uid);
  document.getElementById("controls-section").classList.toggle("hidden", !amDj);
  document.getElementById("add-track-form").classList.toggle("hidden", !amDj);
  document.getElementById("app").classList.remove("hidden");

  initPresence({
    uid: identity.uid,
    nickname: identity.nickname,
    onSync: (users) => renderPresence(users, identity.uid, settings.dj_uid),
  });
}

bootstrap();
