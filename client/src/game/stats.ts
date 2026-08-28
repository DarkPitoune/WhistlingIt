import type { DailyClip } from "../api";

/**
 * How the crowd did on this tune, as one short phrase.
 *
 * Below ten plays it reports the raw ratio instead of a percentage. "50% found
 * it" off two plays reads like a measurement and isn't one; "1 of 2" says the
 * same thing without the false precision.
 *
 * Counted per airing, and the write path is unauthenticated, so this is telemetry
 * rather than a scoreboard.
 *
 * Null when nobody has finished a round yet — "0 of 0" reads as broken, and the
 * two callers want different things in that case: the daily invites you to be
 * first, the reveal drops the line. Deciding that here would put the daily's copy
 * in front of someone who has already played.
 */
export function solveRate(clip: DailyClip): string | null {
  const plays = clip.solvedCount + clip.failedCount;
  if (plays <= 0) return null;

  // Agreement is with the denominator, which is what the noun belongs to:
  // "1 of 1 player has", "1 of 2 players have", "0 of 1 player has".
  if (plays < 10) {
    return `${clip.solvedCount} of ${plays} ${plays === 1 ? "player has" : "players have"} found it`;
  }
  return `${Math.round((clip.solvedCount / plays) * 100)}% of players found it`;
}

/**
 * Who to credit for a whistle.
 *
 * The fallback is deliberately a name rather than "unknown": someone recorded
 * this, and an unsigned contribution is still a contribution.
 */
export function whistlerCredit(clip: { signature: string | null }): string {
  return `by ${clip.signature?.trim() || "Anonymous Whistler"}`;
}
