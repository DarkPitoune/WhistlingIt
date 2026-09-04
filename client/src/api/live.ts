import type { Lang } from "../i18n/lang";
import { type Strings, stringsFor } from "../i18n/strings";
import type { Database } from "./database.types";
import type {
  Category,
  DailyClip,
  RoundResult,
  UploadDraft,
  UploadReceipt,
  WhistlingApi,
} from "./types";

/**
 * The real backend, behind the same WhistlingApi shape as the mock.
 *
 * Two very different services, deliberately:
 *
 * - **The daily comes straight from Supabase**, as a single RPC. It never
 *   touches the ingest API, which is a free-tier container that spins down when
 *   idle. That container can be asleep, cold or broken all day and the game
 *   still works. Do not "tidy" this by routing the daily through the API.
 * - **The booth posts to the ingest API**, which is the only thing that needs
 *   ffmpeg and the note segmenter. It is slow on a cold start, and only an
 *   uploader ever waits on it.
 *
 * Nothing here is authenticated. The anon key is a public identifier, and the
 * whole anon surface on the database side is the one `get_daily` function —
 * `songs` and `daily` deny anon outright, so there is no future puzzle to walk.
 */

// Read the whole object once rather than field by field. Vite substitutes
// `import.meta.env` statically; outside a bundle it is simply absent rather than
// throwing, and the process environment stands in — which is what lets
// scripts/check-play-flow.mjs drive the app's real mapping under plain node
// instead of a copy of it that could drift.
const ENV: Partial<ImportMetaEnv> =
  import.meta.env ??
  (globalThis as { process?: { env?: Partial<ImportMetaEnv> } }).process?.env ??
  {};

const SUPABASE_URL = (ENV.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY ?? "";
const INGEST_URL = (ENV.VITE_INGEST_URL ?? "").replace(/\/+$/, "");

/** True when the environment carries enough to talk to a real backend. */
export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Public bucket, plain CDN path. No signed URLs — the full audio ships anyway. */
const audioUrlFor = (path: string) =>
  `${SUPABASE_URL}/storage/v1/object/public/songs/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

/** The reveal ladder, computed once at ingest. Stored as opaque jsonb. */
interface RevealLadder {
  lead_s: number;
  t0: number;
  starts: number[];
  ends: number[];
}

type SongRow = Database["public"]["Tables"]["songs"]["Row"];

/**
 * get_daily()'s payload: snake_case, and one level flatter than DailyClip.
 *
 * The columns are picked from the generated schema types rather than retyped, so
 * renaming one in a migration breaks `tsc` here instead of failing silently at
 * runtime. `reveal` is `Json` in the schema and gets its real shape back; `date`,
 * `difficulty` and `avg_solve_note` are computed by the function, not columns.
 */
type DailyRow = Pick<
  SongRow,
  | "id"
  | "title"
  | "from_label"
  | "category"
  | "accepted_norm"
  | "audio_path"
  | "n_notes"
  | "duration_s"
> & {
  date: string;
  reveal: RevealLadder;
  avg_solve_level: number;
  solved_count: number;
  failed_count: number;
  signature: string | null;
};

const CATEGORIES: readonly Category[] = ["Film", "Jingle", "TV Series", "Video Games", "Music"];

/**
 * Categories have been renamed a few times. Rows written before a rename still
 * carry the old text, and so does anything the ingest API writes until it is
 * redeployed — without this map they would fall through oneOf() to "Film", which
 * quietly mislabels a real row rather than leaving it unset.
 */
const LEGACY_CATEGORIES: Readonly<Record<string, Category>> = {
  TV: "TV Series",
  Game: "Video Games",
  Pop: "Music",
  Classical: "Music",
};

/**
 * `category` and `difficulty` are plain `text` in Postgres — the allowed values
 * are enforced by the ingest API, not by a check constraint, so a row inserted
 * by hand can carry anything. Coerce rather than crash the screen over a tag.
 */
const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

export function toClip(row: DailyRow): DailyClip {
  const noteStarts = row.reveal?.starts ?? [];
  const noteEnds = row.reveal?.ends ?? [];

  return {
    id: row.id,
    date: row.date,
    audioUrl: audioUrlFor(row.audio_path),
    duration: row.duration_s,
    noteStarts,
    noteEnds,
    // Shipped, but nothing plays from it yet — see DailyClip.startAt. On this
    // repo's reference clip it is 0.0 (the clip opens on the note), so the gap
    // only shows on a real recording with dead air at the front.
    startAt: row.reveal?.t0 ?? 0,
    category: oneOf(CATEGORIES, LEGACY_CATEGORIES[row.category ?? ""] ?? row.category, "Film"),
    // Floored at 1 only. The upper bound is the ladder's length, which is built
    // from the note count in game/levels.ts — clamping properly belongs where the
    // ladder is known, so `notesAtLevel` does it.
    avgSolveLevel: Math.max(1, Math.round(row.avg_solve_level)),
    // Older rows predate the counters; treat a missing count as zero rather than
    // letting NaN reach the percentage.
    solvedCount: Math.max(0, Math.trunc(row.solved_count ?? 0)),
    failedCount: Math.max(0, Math.trunc(row.failed_count ?? 0)),
    title: row.title,
    // Blank collapses to null so the screens have one unsigned case to render,
    // matching what ingest stores.
    signature: (row.signature ?? "").trim() || null,
    // Nullable in the schema, and React would render the word "null".
    from: row.from_label ?? "",
    accepted: row.accepted_norm,
  };
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    // PostgREST puts a readable reason in `message`; anything else is a network
    // or gateway failure and the status is all there is.
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.message ?? `Supabase returned ${res.status}`);
  }
  return (await res.json()) as T;
}

export const liveApi: WhistlingApi = {
  async getDaily(lang: Lang): Promise<DailyClip> {
    const row = await rpc<DailyRow | null>("get_daily", { l: lang });
    if (!row) {
      // Not an error: the pool is genuinely empty, which is day one on this
      // side. App.tsx renders this under "No whistle today".
      throw new Error(stringsFor(lang).emptyPool);
    }
    return toClip(row);
  },

  async getByDate(date: string, lang: Lang): Promise<DailyClip | null> {
    // Null means "nothing was pinned for that day", which is most of the
    // calendar. The server also returns null for a future date rather than
    // letting tomorrow's puzzle be read early.
    const row = await rpc<DailyRow | null>("get_daily_on", { d: date, l: lang });
    return row ? toClip(row) : null;
  },

  async getPuzzleDays(from: string, to: string, lang: Lang) {
    const r = await rpc<{ first: string | null; days: string[] }>("calendar_days", {
      d_from: from,
      d_to: to,
      l: lang,
    });
    // Postgres renders a date as YYYY-MM-DD, which is already the key format the
    // rest of the client uses, so these pass through untouched.
    return { first: r?.first ?? null, days: r?.days ?? [] };
  },

  async submitRound(result: RoundResult): Promise<void> {
    // Fire and forget, and deliberately never rethrown by the caller: the result
    // is already saved locally, so a dropped counter must not cost the player
    // their reveal. `record_round` reports whether it wrote, which is worth a
    // line in the console — a steady stream of `false` means the note count or
    // the song id has drifted, and silence would hide it.
    // The date is what the counters are keyed on, so it has to be the day the
    // round belonged to — not "now". Replaying an old day files the result
    // against that day, which is the whole reason the server takes it.
    const wrote = await rpc<boolean>("record_round", {
      d: result.date,
      song: result.clipId,
      won: result.won,
      solved_at_level: result.won ? result.solvedAtLevel : null,
    });
    if (!wrote) console.warn("[round] the server declined to count this round", result);
  },

  async upload(draft: UploadDraft): Promise<UploadReceipt> {
    const t = stringsFor(draft.lang);
    if (!INGEST_URL) throw new Error(t.upload.boothNotConfigured);

    const form = new FormData();
    // The extension is a hint only: the API transcodes whatever arrives.
    form.append("audio", draft.audio, "take.webm");
    form.append("title", draft.title);
    if (draft.from) form.append("from_label", draft.from);
    form.append("category", draft.category);
    form.append("signature", draft.signature);
    // Which pool the song joins. The API also defaults a missing value to
    // French, for the booth bundle that predates the split — but this is the
    // path that actually decides it, and an English booth must always say so.
    form.append("lang", draft.lang);
    // Repeated field, one value per accepted answer. The API normalises them and
    // stores both the raw and normalised forms.
    for (const a of draft.accepted) form.append("accepted_answers", a);

    // No note boundaries go up. The server re-runs the pitch-plateau segmenter on
    // the transcoded file and its answer is the one that becomes the puzzle, so
    // the booth no longer measures anything to send.

    /*
     * A rejected fetch is not the same failure as an error status, and the
     * difference matters to the person holding the recording.
     *
     * An HTTP error means the booth looked at the take and said no. A rejected
     * fetch means we never heard back — offline, a dropped connection, or a
     * CORS response the browser refused to hand over. In that last case the
     * request was *delivered and processed*: a multipart POST with no custom
     * headers is CORS-safelisted, so there is no preflight to stop it, and only
     * the reply is withheld. The take is very likely in the pool already.
     *
     * So this cannot be left to fall through to the caller, which would put the
     * browser's own words — "Failed to fetch", or "Load failed" on Safari — in
     * a toast, in English, on either side of the site, and call it a failure.
     * The whistler's next move is to check, not to record it all over again.
     */
    let res: Response;
    try {
      res = await fetch(`${INGEST_URL}/uploads`, { method: "POST", body: form });
    } catch (cause) {
      // The original is kept on `cause` rather than in the message: the console
      // still gets "Failed to fetch", the toast does not.
      throw new Error(t.upload.lostContact, { cause });
    }

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(uploadError(res.status, body, t));
    }

    const { id } = (await res.json()) as { id: string; n_notes: number };
    // "queued" is honest: it joins the pool for a future day, not for today.
    return { id, status: "queued" };
  },
};

/**
 * Plain language for the ingest API's failure taxonomy, in the booth's language.
 *
 * The API's own `detail` on a 400 is the one string here that stays English: it
 * is a validation message about a field ("title is too long"), written on the
 * server, and there is no vocabulary of codes to translate it through. Rare
 * enough to live with, and better than dropping the only specific thing the
 * server said.
 */
function uploadError(
  status: number,
  body: { error?: string; reasons?: string[]; detail?: string } | null,
  t: Strings,
): string {
  if (status === 413) return t.upload.tooBig;

  if (status === 422 && body?.reasons?.length) {
    return body.reasons.map((r) => reasonText(r, t)).join(" ");
  }

  if (status === 400) {
    if (body?.error === "bad_audio") return t.upload.badAudio;
    return body?.detail ?? t.upload.badLabels;
  }

  return t.upload.generic;
}

/** The gate's machine-readable reasons, as something a person can act on. */
function reasonText(reason: string, t: Strings): string {
  const reasons = t.upload.reasons;
  return reason in reasons
    ? reasons[reason as keyof typeof reasons]
    : reasons.unknown;
}
