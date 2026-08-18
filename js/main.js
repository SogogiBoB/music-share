import { ensureIdentity } from "./auth.js";
import { claimDjIfVacant, fetchSettings, isCurrentDj } from "./roles.js";

async function bootstrap() {
  const identity = await ensureIdentity();
  await claimDjIfVacant(identity.uid);
  const settings = await fetchSettings();
  const amDj = isCurrentDj(settings, identity.uid);
  document.getElementById("controls-section").classList.toggle("hidden", !amDj);
  document.getElementById("add-track-form").classList.toggle("hidden", !amDj);
  document.getElementById("app").classList.remove("hidden");
}

bootstrap();
