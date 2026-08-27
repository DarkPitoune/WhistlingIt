import type { WhistlingApi } from "./types";
import { mockApi } from "./mock";
import { isConfigured, liveApi } from "./live";

/**
 * The single seam between the app and the backend. Every network call goes through
 * `api`; nothing else in src/ knows whether it is talking to fixtures or a server.
 *
 * The environment picks. With VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set
 * (see .env.example) this is the real backend; without them it falls back to the
 * fixtures, so `npm run dev` works on a fresh clone with no secrets.
 */
export const api: WhistlingApi = isConfigured ? liveApi : mockApi;

/** Which one you got. Logged once at startup so a silent fallback is visible. */
export const apiKind = isConfigured ? "live" : "mock";

export * from "./types";
export { today } from "./day";
