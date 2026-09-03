/**
 * The streak backfill in src/game/storage.ts.
 *
 * Players from before the calendar have one saved round at most — the old key
 * overwrote itself daily — so their grid comes up empty. Their streak record is
 * the one surviving proof of which days they solved, and `recoveredWins` turns it
 * back into squares. It writes to a player's history, so the rules it follows are
 * worth pinning down: never invent a day we already know about, never walk past
 * the ceiling, and never claim anything a streak doesn't actually prove.
 *
 *   node scripts/check-backfill.mjs       (or: npm run check:backfill)
 */

import { recoveredWins } from "../src/game/storage.ts";

const dates = (rs) => rs.map((r) => r.date);
const rounds = (...ds) =>
  Object.fromEntries(ds.map((d) => [d, { date: d, clipId: "real", level: 3, tape: [], guesses: [], done: { won: false } }]));

let failed = 0;
const check = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { console.log(`  ok   ${name}`); return; }
  failed++;
  console.error(`  FAIL ${name}\n       expected ${b}\n       got      ${a}`);
};

// ── what a streak proves ──────────────────────────────────────────────────────
check(
  "a 3-day streak recovers the three days ending at lastWon",
  dates(recoveredWins({ count: 3, lastWon: "2026-09-03" }, {})),
  ["2026-09-03", "2026-09-02", "2026-09-01"],
);

check(
  "the walk crosses a month boundary by the calendar, not by arithmetic on the day",
  dates(recoveredWins({ count: 3, lastWon: "2026-09-01" }, {})),
  ["2026-09-01", "2026-08-31", "2026-08-30"],
);

check(
  "and a leap day, since 2028 is one",
  dates(recoveredWins({ count: 3, lastWon: "2028-03-01" }, {})),
  ["2028-03-01", "2028-02-29", "2028-02-28"],
);

check(
  "every recovered day is marked won — a streak is only ever written by a win",
  recoveredWins({ count: 2, lastWon: "2026-09-03" }, {}).every((r) => r.done?.won === true),
  true,
);

check(
  "and carries no clip, so the day stays properly playable rather than faking a tape",
  recoveredWins({ count: 1, lastWon: "2026-09-03" }, {}).every((r) => r.clipId === ""),
  true,
);

// ── what it must not touch ────────────────────────────────────────────────────
check(
  "a day already in the store is left alone, even one the streak thinks was won",
  dates(recoveredWins({ count: 3, lastWon: "2026-09-03" }, rounds("2026-09-02"))),
  ["2026-09-03", "2026-09-01"],
);

check(
  "nothing to go on: no streak record at all",
  recoveredWins(null, {}),
  [],
);

check(
  "nothing to go on: a streak reset to zero by a miss keeps its lastWon, and proves nothing",
  recoveredWins({ count: 0, lastWon: "2026-09-03" }, {}),
  [],
);

check(
  "nothing to go on: a fresh device has a count but never won a day",
  recoveredWins({ count: 4, lastWon: null }, {}),
  [],
);

// ── junk in the store ─────────────────────────────────────────────────────────
// localStorage is the player's to edit and an old build's to have mangled, so a
// count that isn't a sane positive integer must not hang the page or emit rubbish.
check(
  "a corrupt count is capped rather than looped over",
  recoveredWins({ count: 1e9, lastWon: "2026-09-03" }, {}).length,
  366,
);

check(
  "a negative count recovers nothing",
  recoveredWins({ count: -5, lastWon: "2026-09-03" }, {}),
  [],
);

check(
  "a fractional count is floored",
  dates(recoveredWins({ count: 2.7, lastWon: "2026-09-03" }, {})),
  ["2026-09-03", "2026-09-02"],
);

check(
  "a count that isn't a number at all recovers nothing",
  recoveredWins({ count: "12", lastWon: "2026-09-03" }, {}),
  [],
);

// ── idempotence ───────────────────────────────────────────────────────────────
// The write side runs this once and latches a flag, but the flag can be lost —
// private mode, a cleared key. Feeding the result back in must then be a no-op
// rather than a second helping.
const first = recoveredWins({ count: 5, lastWon: "2026-09-03" }, {});
const store = Object.fromEntries(first.map((r) => [r.date, r]));
check(
  "re-running against its own output recovers nothing further",
  recoveredWins({ count: 5, lastWon: "2026-09-03" }, store),
  [],
);

console.log(failed ? `\n${failed} failed` : "\nbackfill ok");
process.exit(failed ? 1 : 0);
