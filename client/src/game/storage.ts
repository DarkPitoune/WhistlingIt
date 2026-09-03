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
  return rounds;
}

/** The saved round for a date, but only if it belongs to that day's clip. */
export function loadRound(date: string, clipId: string): SavedRound | null {
  const r = loadRounds()[date];
  return r && r.clipId === clipId ? r : null;
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

interface StreakRecord { count: number; lastWon: string | null }

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
