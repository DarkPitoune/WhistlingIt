import type { DailyClip } from "../api";

/** The reveal curve: one note, then two, three, five, eight — then the lot. */
const FIB_RUNGS = [1, 2, 3, 5, 8];

/** Six rungs whenever there is room for six distinct note counts. */
const RUNGS = 6;

/**
 * How much of the tune each miss buys.
 *
 * Fibonacci rather than one-note-at-a-time: the gaps widen as you go, so an early
 * miss costs little and a late one hands over a lot. It also front-loads the
 * tension — one note is almost nothing to go on.
 *
 * Below nine notes the Fibonacci rungs run out before six levels do, so the gaps
 * are padded with the largest note counts still free. Filling from the top is
 * deliberate: it keeps the opening as stingy as the sequence intends, where
 * filling from the bottom would hand over four notes before five and make the
 * early game generous. A tune with fewer than six notes simply has fewer levels —
 * there are not six distinct counts to offer.
 *
 * `level_count()` in SQL mirrors the *length* of this, as `least(6, n_notes)`.
 * That identity is what the two agreeing depends on, so any change here has to
 * keep it true or the server will reject scores the client can reach.
 */
export function makeLadder(noteCount: number): number[] {
  const n = Math.max(0, Math.trunc(noteCount));
  if (n <= 0) return [];

  const rungs = FIB_RUNGS.filter((x) => x < n);
  const used = new Set(rungs);
  for (let candidate = n - 1; rungs.length < RUNGS - 1 && candidate >= 1; candidate--) {
    if (!used.has(candidate)) {
      rungs.push(candidate);
      used.add(candidate);
    }
  }
  rungs.sort((a, b) => a - b);
  return [...rungs, n];
}

/** Seconds of the clip unlocked at a given rung — the end of the last unlocked note. */
export function unlockedSeconds(clip: DailyClip, notes: number): number {
  return clip.noteEnds[Math.min(notes, clip.noteEnds.length) - 1] ?? clip.duration;
}

/**
 * Notes unlocked at a 1-based ladder rung.
 *
 * The inverse of the scoring the server stores: a round's score is its rung
 * (1..ladder.length, always one apart), and this turns a rung back into the note
 * count a player actually reads. Clamped, because the average arrives from the
 * server and a ladder shorter than it expects must not index past the end.
 */
export function notesAtLevel(ladder: readonly number[], level: number): number {
  if (ladder.length === 0) return 0;
  const i = Math.min(Math.max(1, Math.round(level)), ladder.length) - 1;
  return ladder[i] ?? ladder[ladder.length - 1] ?? 0;
}

/**
 * Where the tune ends, which is not where the file ends.
 *
 * `duration` is the whole recording, trailing silence and ring-out included — on the
 * reference clip that's 0.25s more than the last note. The bar is scaled to this
 * instead, so the final rung fills it completely rather than leaving a sliver of
 * hatching over dead air that no rung can ever buy.
 */
export function tuneEnd(clip: DailyClip): number {
  return clip.noteEnds[clip.noteEnds.length - 1] ?? clip.duration;
}
