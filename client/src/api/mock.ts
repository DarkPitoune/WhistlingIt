import type { DailyClip, RoundResult, UploadDraft, UploadReceipt, WhistlingApi } from "./types";
import hedwig from "./fixtures/hedwig.json";

/**
 * Stands in for the backend. One clip, served for every day, with a little latency
 * so loading states are real. Uploads are logged and dropped.
 */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Local date as YYYY-MM-DD. Deliberately local, not UTC — see the timezone question. */
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const mockApi: WhistlingApi = {
  async getDaily() {
    await wait(320);
    // The fixture carries a fixed date; the mock always serves it as today's round.
    return { ...(hedwig as DailyClip), date: today() };
  },

  async submitRound(result: RoundResult) {
    await wait(180);
    console.info("[mock] round", result);
  },

  async upload(draft: UploadDraft): Promise<UploadReceipt> {
    await wait(900);
    console.info("[mock] upload", {
      ...draft,
      audio: `${draft.audio.type || "audio"}, ${(draft.audio.size / 1024).toFixed(0)} KiB`,
    });
    return { id: `draft_${Math.random().toString(36).slice(2, 10)}`, status: "queued" };
  },
};
