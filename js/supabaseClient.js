import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = typeof window !== "undefined" && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : undefined;
