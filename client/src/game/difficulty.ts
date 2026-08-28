import type { Difficulty } from "../api";

/**
 * How hard a tune turned out to be, in six steps, from how far the average solver
 * had to go.
 *
 * Named on moving air, because a whistle is nothing but moving air and the joke
 * writes itself — the scale climbs a wind, breeze to hurricane. The first rung is
 * the only earnest one: if the crowd gets it off a single note, no adjective is
 * going to sell that as a challenge.
 *
 * Ordered easiest to hardest. Position in this array is the scale, so inserting
 * one in the middle reshuffles every label — append or replace, don't splice.
 */
const NAMES = [
  "Trivial",          // one note was enough. Well done, everyone.
  "A Breeze",         // barely troubled anyone
  "Gust",             // the first one that shoves back
  "Storm",            // no longer a passing thing
  "Gasping for Air",  // the only rung about the player, not the weather
  "Hurricane",        // nobody is standing up in this
] as const satisfies readonly Difficulty[];

/**
 * The label for an average rung.
 *
 * Scaled across the ladder rather than indexed by it: a short tune has fewer
 * rungs, and its last rung should still read as the hardest thing on offer rather
 * than stopping at "Gust" because it only had three levels.
 */
export function difficultyFor(ladder: readonly number[], avgLevel: number): Difficulty {
  return NAMES[difficultyStep(ladder, avgLevel) - 1] ?? NAMES[0];
}

/** How many steps the scale has. The colour ramp is built from this. */
export const DIFFICULTY_STEPS = NAMES.length;

/**
 * Which step of the scale, 1..DIFFICULTY_STEPS.
 *
 * Separate from the label because the pill is coloured by position, and deriving
 * that by searching NAMES for the string would break the moment two rungs shared
 * a name.
 */
export function difficultyStep(ladder: readonly number[], avgLevel: number): number {
  const rungs = ladder.length;
  if (rungs <= 1) return 1;

  const level = Math.min(Math.max(1, Math.round(avgLevel)), rungs);
  const i = Math.round(((level - 1) / (rungs - 1)) * (NAMES.length - 1));
  return Math.min(Math.max(1, i + 1), NAMES.length);
}
