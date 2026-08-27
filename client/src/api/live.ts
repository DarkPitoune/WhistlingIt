import type { Database } from "./database.types";
import type {
  Category,
  DailyClip,
  Difficulty,
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
  difficulty: string;
  avg_solve_note: number;
};

const CATEGORIES: readonly Category[] = ["Film", "Jingle", "TV", "Game", "Pop", "Classical"];
const DIFFICULTIES: readonly Difficulty[] = ["Easy", "Fair", "Tricky", "Brutal"];

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
    category: oneOf(CATEGORIES, row.category, "Film"),
    difficulty: oneOf(DIFFICULTIES, row.difficulty, "Fair"),
    // Clamped because the bar indexes noteEnds with it.
    avgSolveNote: Math.min(Math.max(1, Math.round(row.avg_solve_note)), noteEnds.length || 1),
    title: row.title,
    // Nullable in the schema, and React would render the word "null".
    from: row.from_label ?? "",
    accepted: row.accepted_norm,
  };
}

async function rpc<T>(fn: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
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
  async getDaily(): Promise<DailyClip> {
    const row = await rpc<DailyRow | null>("get_daily");
    if (!row) {
      // Not an error: the pool is genuinely empty, which is day one. App.tsx
      // renders this under "No whistle today".
      throw new Error("Nobody has whistled yet. The booth is open.");
    }
    return toClip(row);
  },

  async submitRound(_result: RoundResult): Promise<void> {
    // Intentionally does nothing. Difficulty and the average solve note are the
    // only things this would feed, and both need a write per play — deferred, so
    // get_daily() serves placeholders for them. When the play counters land, this
    // becomes one more rpc() call and nothing else in the app changes.
    return;
  },

  async upload(draft: UploadDraft): Promise<UploadReceipt> {
    if (!INGEST_URL) throw new Error("The booth is not configured (VITE_INGEST_URL).");

    const form = new FormData();
    // The extension is a hint only: the API transcodes whatever arrives.
    form.append("audio", draft.audio, "take.webm");
    form.append("title", draft.title);
    if (draft.from) form.append("from_label", draft.from);
    form.append("category", draft.category);
    // Repeated field, one value per accepted answer. The API normalises them and
    // stores both the raw and normalised forms.
    for (const a of draft.accepted) form.append("accepted_answers", a);

    // draft.noteStarts / noteEnds are deliberately not sent. The booth's onset
    // detector is a hint for the whistler ("14 notes found"); the server re-runs
    // the pitch-plateau segmenter on the transcoded file and its answer is the
    // one that becomes the puzzle. Sending ours would imply it could win.

    const res = await fetch(`${INGEST_URL}/uploads`, { method: "POST", body: form });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(uploadError(res.status, body));
    }

    const { id } = (await res.json()) as { id: string; n_notes: number };
    // "queued" is honest: it joins the pool for a future day, not for today.
    return { id, status: "queued" };
  },
};

/** Plain language for the ingest API's failure taxonomy. */
function uploadError(status: number, body: { error?: string; reasons?: string[]; detail?: string } | null): string {
  if (status === 413) return "That recording is too big. Keep it under 10 MB.";

  if (status === 422 && body?.reasons?.length) {
    return body.reasons.map(reasonText).join(" ");
  }

  if (status === 400) {
    if (body?.error === "bad_audio") return "We couldn't read that recording. Try again.";
    return body?.detail ?? "Something in the labels wasn't right.";
  }

  return "Upload failed. Your take is still here — try again.";
}

/** The gate's machine-readable reasons, as something a person can act on. */
function reasonText(reason: string): string {
  switch (reason) {
    case "not_whistle_like":
      return "That doesn't sound like a whistle — humming and recordings don't pass.";
    case "too_few_notes":
      return "Too short to guess from. Whistle a few more notes.";
    case "too_many_notes":
      return "That's a long one. Trim it to a recognisable phrase.";
    case "too_short":
      return "That's too short.";
    case "too_long":
      return "That's over 40 seconds. Trim it to the tune.";
    case "clipping":
      return "It's clipping. Move back from the mic and try again.";
    case "not_enough_voiced_audio":
      return "Mostly silence or noise. Get closer to the mic.";
    default:
      return "We couldn't use that take.";
  }
}
