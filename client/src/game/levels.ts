import type { DailyClip } from "../api";

/**
 * The ladder: three notes, then one more per miss, then the whole tune.
 *
 * Derived from the clip's note count rather than hardcoded to 14, and clamped so a
 * short clip doesn't offer levels it can't fill.
 *
 * Open question, unresolved: notes are an uneven currency. On the Hedwig clip, three
 * notes is 1.86s but note 4 buys only 0.62s more while note 7 buys 1.86s. If we
 * decide a level should be "the next note or +1.5s, whichever is longer", it changes
 * here and nowhere else.
 */
export function makeLadder(noteCount: number): number[] {
  const steps = [3, 4, 5, 6, 7].filter((n) => n < noteCount);
  return [...steps, noteCount];
}

/** Seconds of the clip unlocked at a given rung — the end of the last unlocked note. */
export function unlockedSeconds(clip: DailyClip, notes: number): number {
  // The last rung is the whole file, tail included. Stopping at the final note's end
  // would leave the ring-out hatched, so the bar could never fill.
  if (notes >= clip.noteEnds.length) return clip.duration;
  return clip.noteEnds[notes - 1] ?? clip.duration;
}
