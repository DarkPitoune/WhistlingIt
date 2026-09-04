import type { Lang } from "../i18n/lang";
import type { DailyClip, RoundResult, UploadDraft, UploadReceipt, WhistlingApi } from "./types";
import { today } from "./day";
import hedwig from "./fixtures/hedwig.json";

/**
 * Stands in for the backend. One clip, served for every day, with a little latency
 * so loading states are real. Uploads are logged and dropped.
 *
 * Both sides serve the same fixture, with the title marked so it is obvious at a
 * glance which one is on screen. Deliberately *not* an empty English pool even
 * though that is what production starts with: an empty pool renders one static
 * screen, and then there is no way to develop the English game against fixtures
 * at all. The empty-pool path is reachable by pointing the client at a real
 * database, and it is the same code path in both languages.
 */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The day the real game started, so the calendar's back-stop looks plausible. */
const MOCK_FIRST_DAY = "2026-08-27";
/** English started later, so the two calendars stop paging back in different places. */
const MOCK_FIRST_DAY_EN = "2026-09-01";
/** Two days the fixture pretends nobody was served a whistle. */
const MOCK_GAPS = new Set(["2026-08-30", "2026-09-02"]);

/** The day after `key`, as a key. Pure calendar arithmetic, like api/day.ts. */
function nextDay(key: string): string {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  const p2 = (v: number) => String(v).padStart(2, "0");
  return `${n.getUTCFullYear()}-${p2(n.getUTCMonth() + 1)}-${p2(n.getUTCDate())}`;
}

/**
 * The fixture, stamped with the side it is standing in for.
 *
 * The id changes with the language too. It is what `loadRound` matches a saved
 * round against, so sharing one id would let a round played on the French mock
 * restore itself onto the English one and look like a bug in the storage split.
 */
const clipFor = (lang: Lang, date: string): DailyClip => {
  const base = hedwig as DailyClip;
  return lang === "fr"
    ? { ...base, date }
    : { ...base, date, id: `${base.id}-en`, title: `${base.title} (EN)` };
};

const firstDay = (lang: Lang) => (lang === "fr" ? MOCK_FIRST_DAY : MOCK_FIRST_DAY_EN);

export const mockApi: WhistlingApi = {
  async getDaily(lang: Lang) {
    await wait(320);
    // The fixture carries a fixed date; the mock always serves it as today's round.
    return clipFor(lang, today());
  },

  async getByDate(date: string, lang: Lang) {
    await wait(260);
    // One fixture stands in for every day, but the future is still refused, so
    // the calendar behaves the same against fixtures as against the server.
    if (date > today()) return null;
    if (date < firstDay(lang)) return null;
    return clipFor(lang, date);
  },

  async getPuzzleDays(from: string, to: string, lang: Lang) {
    await wait(140);
    // Every day since this side started, minus a couple of holes so the grid's
    // "no puzzle that day" state is visible against fixtures too — otherwise the
    // only way to see it is to run the mock on its very first day.
    const first = firstDay(lang);
    const days: string[] = [];
    for (let d = first; d <= today() && d <= to; d = nextDay(d)) {
      if (d >= from && !MOCK_GAPS.has(d)) days.push(d);
    }
    return { first, days };
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
