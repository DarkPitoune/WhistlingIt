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
