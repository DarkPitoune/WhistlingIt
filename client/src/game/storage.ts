import type { TryKind } from "../api";
import { today } from "../api/day";

/**
 * Everything here is device-local. Streaks imply identity, and we start without
 * accounts — a refresh mid-round must not hand out a free retry, so the round is
 * persisted the moment it changes.
 *
 * Rounds are keyed by the puzzle date from `day.ts` — Europe/Paris — matching
 * `puzzle_date` on the server. Keying on the device's local date would file a
 * result under a day the server has not reached and, for anyone outside the
 * zone, put it in the wrong square on the calendar.
 */

const ROUNDS_KEY = "whistlingit.rounds";
const STREAK_KEY = "whistlingit.streak";

/** The pre-calendar store: one round, overwritten daily. Migrated on first read. */
const LEGACY_ROUND_KEY = "whistlingit.round";

/** Set once the streak backfill below has run, so it never runs twice. */
const BACKFILL_KEY = "whistlingit.backfilled";

/**
 * The clip id on a round we inferred rather than watched.
 *
 * Empty on purpose: `loadRound` hands back a saved round only when its clipId
 * matches the day's clip, and no real clip is named "". So a recovered day
 * colours its square and is still there to be played properly — we know the
 * player won it, and nothing more, so pretending to a tape we never saw would
 * be the lie.
 */
const RECOVERED_CLIP = "";

/**
 * A ceiling on how far back the backfill will walk.
 *
 * Nothing should ever reach it — the game is younger than this. It is here so a
 * corrupt count can't turn a page load into an unbounded loop.
 */
const MAX_BACKFILL = 366;

export interface SavedRound {
  date: string;
  clipId: string;
  level: number;
  tape: TryKind[];
  /** The wrong guesses, in order. They stay on screen for the whole round. */
  guesses: string[];
  done: null | { won: boolean };
}

/** Every round this device has played, keyed by puzzle date. */
export type Rounds = Record<string, SavedRound>;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;   // private mode, quota, or a shape we no longer understand
  }
}

function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not fatal */ }
}

/**
 * All saved rounds, folding in the single round the old key may still hold.
 *
 * The migration is read-only until something is saved, so a visit that changes
 * nothing leaves both keys alone. The legacy key is never deleted: it costs a few
 * bytes, and keeping it means downgrading to an older build doesn't lose the day.
 */
export function loadRounds(): Rounds {
  const rounds = read<Rounds>(ROUNDS_KEY) ?? {};
  const legacy = read<SavedRound>(LEGACY_ROUND_KEY);
  if (legacy?.date && !rounds[legacy.date]) rounds[legacy.date] = legacy;
  backfill(rounds);
  return rounds;
}

/**
 * Rebuild the days a streak proves were won.
 *
 * Anyone who played before the calendar existed has almost no history to show:
 * the old key held one round and overwrote it every morning, so their grid comes
 * up empty however long they have been playing. Their actual history is gone and
 * no amount of care brings it back.
 *
 * What survives is the streak. `{count: 12, lastWon: "2026-09-03"}` is a claim
 * about twelve specific dates — the twelve consecutive days ending on that one —
 * and it is only ever written by a win, so every date it names was solved. That
 * is a small recovery, but it is exactly the player it matters most to: the one
 * with the longest run and the emptiest calendar.
 *
 * What it cannot say anything about is losses and days skipped. Those stay
 * "not played", which is the truthful square rather than a wrong one. A player
 * with a twelve-day streak and three earlier misses sees twelve solved and three
 * blank, and nothing on screen claims otherwise.
 *
 * Nothing here can invent a day that had no whistle: a streak was only ever
 * earned on days the game actually set one, so the recovered dates are real
 * puzzle dates by construction and can't light up a dead square.
 */
function backfill(rounds: Rounds): void {
  if (read<boolean>(BACKFILL_KEY)) return;

  const found = recoveredWins(read<StreakRecord>(STREAK_KEY), rounds);
  for (const r of found) rounds[r.date] = r;

  /*
   * Marked done even when it recovered nothing, and this is the load-bearing
   * half. Without the flag the walk would re-run on every read, and a recovered
   * day the player then replays and loses would be quietly repainted green the
   * next time the calendar opened — the inferred history overwriting the real
   * one, forever. Once is the whole idea.
   */
  write(BACKFILL_KEY, true);
  if (found.length) write(ROUNDS_KEY, rounds);
}

/**
 * The rounds a streak record implies, minus any date already known.
 *
 * Split out from the localStorage half so it can be checked directly —
 * see scripts/check-backfill.mjs. Existing rounds always win: a round we watched
 * beats one we deduced, including a loss on a day the streak thinks was won.
 */
export function recoveredWins(s: StreakRecord | null, existing: Rounds): SavedRound[] {
  // localStorage is the player's to edit and an old build's to have mangled, so
  // the count is treated as untrusted input rather than as a number: a string, a
  // NaN or an Infinity all have to fall out here, not halfway down the loop.
  if (!s?.lastWon || typeof s.count !== "number" || !(s.count >= 1)) return [];

  const out: SavedRound[] = [];
  const n = Math.min(Math.floor(s.count), MAX_BACKFILL);
  for (let i = 0; i < n; i++) {
    const date = shiftDate(s.lastWon, -i);
    if (existing[date]) continue;
    out.push({
      date,
      clipId: RECOVERED_CLIP,
      level: 0,
      tape: [],
      guesses: [],
      done: { won: true },
    });
  }
  return out;
}

/** Plain calendar arithmetic on a YYYY-MM-DD key. No zone, same as daysBetween. */
function shiftDate(date: string, by: number): string {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + by));
  const p2 = (v: number) => String(v).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}

/**
 * A round we deduced from the streak rather than watched: we know the day was
 * won, and nothing else about it.
 */
export const isRecovered = (r: SavedRound): boolean =>
  r.clipId === RECOVERED_CLIP && !!r.done;

/**
 * The saved round for a date, but only if it belongs to that day's clip.
 *
 * A recovered round is the exception, because it isn't about a clip at all — it
 * is the bare fact that the day was solved, and it belongs to whichever whistle
 * that date turns out to hold. Excluding it would leave the calendar showing a
 * solved day that opens as an untouched puzzle.
 */
export function loadRound(date: string, clipId: string): SavedRound | null {
  const r = loadRounds()[date];
  if (!r) return null;
  return r.clipId === clipId || isRecovered(r) ? r : null;
}

export function saveRound(r: SavedRound): void {
  const rounds = loadRounds();
  rounds[r.date] = r;
  write(ROUNDS_KEY, rounds);
}

/** Finished rounds only, as date → won. What the calendar colours its squares by. */
export function loadResults(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [date, r] of Object.entries(loadRounds())) {
    if (r.done) out[date] = r.done.won;
  }
  return out;
}

/**
 * Whether today's round has been played to the end.
 *
 * The gate on the archive: today comes first, and the rest of the calendar opens
 * once you've had your answer. A loss counts as finished — the round is over
 * either way, and locking the archive behind a win would punish the day you most
 * want to go looking at other tunes.
 *
 * Read fresh rather than cached, because the round that satisfies it is usually
 * finished in this same session.
 */
export function finishedToday(): boolean {
  return !!loadRounds()[today()]?.done;
}

export interface StreakRecord { count: number; lastWon: string | null }

export function loadStreak(): number {
  const s = read<StreakRecord>(STREAK_KEY);
  if (!s || !s.lastWon) return 0;
  // Shown as live only while it could still be extended: today or yesterday.
  return daysBetween(s.lastWon, today()) <= 1 ? s.count : 0;
}

/**
 * Bump on a win, reset on a miss. Called once, when the round ends.
 *
 * Only today's round moves it. Past days are playable from the calendar, and
 * letting those count would turn the streak into something you can repair after
 * the fact — so a back-filled day is recorded and coloured, but never counted.
 */
export function recordResult(won: boolean, date: string): number {
  const day = today();
  const s = read<StreakRecord>(STREAK_KEY) ?? { count: 0, lastWon: null };
  if (date !== day) return loadStreak();

  if (!won) {
    write(STREAK_KEY, { count: 0, lastWon: s.lastWon });
    return 0;
  }
  if (s.lastWon === day) return s.count;   // already counted this day
  const carry = s.lastWon && daysBetween(s.lastWon, day) === 1 ? s.count : 0;
  const next = carry + 1;
  write(STREAK_KEY, { count: next, lastWon: day });
  return next;
}

function daysBetween(a: string, b: string): number {
  const [ay = 0, am = 1, ad = 1] = a.split("-").map(Number);
  const [by = 0, bm = 1, bd = 1] = b.split("-").map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}
