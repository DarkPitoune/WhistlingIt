import type { DailyClip } from "../api";
import type { Strings } from "../i18n/strings";

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
export function solveRate(clip: DailyClip, t: Strings): string | null {
  const plays = clip.solvedCount + clip.failedCount;
  if (plays <= 0) return null;

  // The sentence itself is the dictionary's, because the agreement rules differ:
  // English agrees with the denominator ("1 of 2 players have"), French with the
  // numerator ("1 joueur sur 2 l'a trouvé"). Only the threshold is shared.
  if (plays < 10) return t.stats.solveRateFew(clip.solvedCount, plays);
  return t.stats.solveRateMany(Math.round((clip.solvedCount / plays) * 100));
}

/**
 * Who to credit for a whistle.
 *
 * The fallback is deliberately a name rather than "unknown": someone recorded
 * this, and an unsigned contribution is still a contribution.
 */
export function whistlerCredit(clip: { signature: string | null }, t: Strings): string {
  return t.stats.whistlerCredit(clip.signature?.trim() || t.stats.anonymousWhistler);
}
