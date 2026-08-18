import { ensureIdentity } from "./auth.js";

async function bootstrap() {
  const identity = await ensureIdentity();
  console.log("접속:", identity);
}

bootstrap();
