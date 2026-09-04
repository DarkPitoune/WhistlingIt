import type { TryKind } from "../api";
import { today } from "../api/day";
import type { Lang } from "../i18n/lang";

/**
 * Everything here is device-local. Streaks imply identity, and we start without
 * accounts — a refresh mid-round must not hand out a free retry, so the round is
 * persisted the moment it changes.
 *
 * Rounds are keyed by the puzzle date from `day.ts` — Europe/Paris — matching
 * `puzzle_date` on the server. Keying on the device's local date would file a
 * result under a day the server has not reached and, for anyone outside the
 * zone, put it in the wrong square on the calendar.
 *
 * ── two of everything ──────────────────────────────────────────────────────
 * `fr` and `en` are separate games with separate song pools, so they get
 * separate stores: two round maps, two streaks, two backfill flags. Sharing a
 * streak across them would let a player keep a run alive by switching sides on a
 * day they missed, and sharing the round map would file both days under one date
 * key — which is the same key, since the two puzzles rotate together.
 *
 * Every function below therefore takes the side. None of them defaults it: the
 * argument is the only thing standing between a French player's history and an
 * English one's, and a default is how that gets forgotten at one call site.
 */

/**
 * `whistlingit.rounds.fr`, `whistlingit.streak.en`, and so on.
 *
 * Suffixed rather than nested under one object, so the two sides can never be
 * lost together by one bad write, and so the migration below is a copy rather
 * than a restructure.
 */
const roundsKey = (lang: Lang) => `whistlingit.rounds.${lang}`;
const streakKey = (lang: Lang) => `whistlingit.streak.${lang}`;
const backfillKey = (lang: Lang) => `whistlingit.backfilled.${lang}`;

/**
 * The unsuffixed keys, from when there was only one game.
 *
 * All French: the site was French-facing for its whole life before the split, so
 * every round and every streak sitting in these keys was earned on the French
 * pool. They are copied across on first read and then left alone — see
 * `migrateToFrench`.
 */
const PRE_SPLIT_KEYS = {
  rounds: "whistlingit.rounds",
  streak: "whistlingit.streak",
  /** The pre-calendar store: one round, overwritten daily. */
  round: "whistlingit.round",
  backfilled: "whistlingit.backfilled",
} as const;

/** Set once the copy below has run, so it never runs twice. */
const SPLIT_KEY = "whistlingit.split";

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
 * Move the pre-split history onto the French side.
 *
 * Runs once, before the first read of either side, and copies rather than moves:
 * the unsuffixed keys stay exactly where they are. That costs a few kilobytes
 * and buys two things — rolling the deploy back doesn't lose anyone's streak,
 * and a bug in the copy is recoverable because the original is still there.
 *
 * The backfill flag comes along too, and that part is load-bearing. Without it
 * the streak backfill from the previous release would run a second time on the
 * French store, re-deducing wins for days the player has since replayed and
 * lost, and quietly repainting those squares green.
 *
 * Nothing is copied to English. There is no English history to have: the pool
 * starts empty, so its first round is genuinely its first.
 */
function migrateToFrench(): void {
  if (read<boolean>(SPLIT_KEY)) return;

  // The flag goes down first. If a quota error stops one of the writes below,
  // a retry on the next page load would be the worse outcome: the copy is not
  // idempotent once the player has started winning on the French keys.
  write(SPLIT_KEY, true);

  const rounds = read<Rounds>(PRE_SPLIT_KEYS.rounds);
  const streak = read<StreakRecord>(PRE_SPLIT_KEYS.streak);
  const legacy = read<SavedRound>(PRE_SPLIT_KEYS.round);
  const backfilled = read<boolean>(PRE_SPLIT_KEYS.backfilled);

  const merged: Rounds = { ...(rounds ?? {}) };
  // Fold in the one round the pre-calendar key may still hold, same rule as
  // before: a round we have in the map wins over the single overwritten one.
  if (legacy?.date && !merged[legacy.date]) merged[legacy.date] = legacy;

  if (Object.keys(merged).length) write(roundsKey("fr"), merged);
  if (streak) write(streakKey("fr"), streak);
  if (backfilled) write(backfillKey("fr"), true);
}

/**
 * All saved rounds for one side.
 *
 * Reads are what trigger the one-off migration, so there is no separate startup
 * step to forget to call — every path into this module comes through here.
 */
export function loadRounds(lang: Lang): Rounds {
  migrateToFrench();
  const rounds = read<Rounds>(roundsKey(lang)) ?? {};
  backfill(rounds, lang);
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
function backfill(rounds: Rounds, lang: Lang): void {
  if (read<boolean>(backfillKey(lang))) return;

  const found = recoveredWins(read<StreakRecord>(streakKey(lang)), rounds);
  for (const r of found) rounds[r.date] = r;

  /*
   * Marked done even when it recovered nothing, and this is the load-bearing
   * half. Without the flag the walk would re-run on every read, and a recovered
   * day the player then replays and loses would be quietly repainted green the
   * next time the calendar opened — the inferred history overwriting the real
   * one, forever. Once is the whole idea.
   */
  write(backfillKey(lang), true);
  if (found.length) write(roundsKey(lang), rounds);
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
export function loadRound(date: string, clipId: string, lang: Lang): SavedRound | null {
  const r = loadRounds(lang)[date];
  if (!r) return null;
  return r.clipId === clipId || isRecovered(r) ? r : null;
}

export function saveRound(r: SavedRound, lang: Lang): void {
  const rounds = loadRounds(lang);
  rounds[r.date] = r;
  write(roundsKey(lang), rounds);
}

/** Finished rounds only, as date → won. What the calendar colours its squares by. */
export function loadResults(lang: Lang): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [date, r] of Object.entries(loadRounds(lang))) {
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
export function finishedToday(lang: Lang): boolean {
  return !!loadRounds(lang)[today()]?.done;
}

export interface StreakRecord { count: number; lastWon: string | null }

export function loadStreak(lang: Lang): number {
  migrateToFrench();
  const s = read<StreakRecord>(streakKey(lang));
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
export function recordResult(won: boolean, date: string, lang: Lang): number {
  const day = today();
  migrateToFrench();
  const s = read<StreakRecord>(streakKey(lang)) ?? { count: 0, lastWon: null };
  if (date !== day) return loadStreak(lang);

  if (!won) {
    write(streakKey(lang), { count: 0, lastWon: s.lastWon });
    return 0;
  }
  if (s.lastWon === day) return s.count;   // already counted this day
  const carry = s.lastWon && daysBetween(s.lastWon, day) === 1 ? s.count : 0;
  const next = carry + 1;
  write(streakKey(lang), { count: next, lastWon: day });
  return next;
}

function daysBetween(a: string, b: string): number {
  const [ay = 0, am = 1, ad = 1] = a.split("-").map(Number);
  const [by = 0, bm = 1, bd = 1] = b.split("-").map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}
