import type { WhistlingApi } from "./types";
import { mockApi } from "./mock";

/**
 * The single seam between the app and the backend. Every network call goes through
 * `api`; nothing else in src/ knows whether it is talking to fixtures or a server.
 *
 * To go live: write an adapter implementing WhistlingApi against your endpoints and
 * export it here instead.
 */
export const api: WhistlingApi = mockApi;

export * from "./types";
export { today } from "./mock";
