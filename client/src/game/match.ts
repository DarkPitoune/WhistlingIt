/**
 * Guess matching. Ported from the design page, with the combining-diacritics range
 * written as an escape rather than as literal marks in the source.
 *
 * Guessing is free text with no autocomplete — a dropdown would leak the answer — so
 * this list is the entire matching logic. It runs client-side, which means the
 * accepted answers are visible in devtools. Deliberate; see src/api/types.ts.
 */

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // strip accents
    .replace(/[^a-z0-9 ]/g, " ")        // punctuation becomes a gap
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True if `guess` matches any accepted answer.
 *
 * Forward: the guess contains an accepted answer, so "it's harry potter innit"
 * counts. Reverse: an accepted answer contains the guess, for typos and truncation
 * — but only when the guess covers nearly the whole answer, or a fragment like
 * "the", "pot" or "wig" would score a win.
 */
export function isRight(guess: string, accepted: readonly string[]): boolean {
  const n = normalise(guess);
  if (n.length < 3) return false;
  return accepted.some((raw) => {
    const a = normalise(raw);
    if (!a) return false;
    return n.includes(a) || (n.length >= 6 && n.length >= a.length - 2 && a.includes(n));
  });
}
