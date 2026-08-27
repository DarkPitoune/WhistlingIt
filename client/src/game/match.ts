/**
 * Guess matching. Ported from the design page, with the combining-diacritics range
 * written as an escape rather than as literal marks in the source.
 *
 * Guessing is free text with no autocomplete — a dropdown would leak the answer — so
 * this list is the entire matching logic. It runs client-side, which means the
 * accepted answers are visible in devtools. Deliberate; see src/api/types.ts.
 *
 * `normalise` is mirrored in Python at server/api/app/normalize.py, which is what
 * normalises `accepted` at ingest. The two must agree exactly or a puzzle can ship
 * with answers no correct guess can ever match — so both are tested against the same
 * fixture list, server/api/tests/normalize_fixtures.json. Keep it small.
 */

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")     // strip accents
    // Apostrophes vanish rather than becoming a gap, so "Hedwig's" is "hedwigs" and
    // not "hedwig s". A gap here would not match an accepted answer stored the
    // obvious way, which is the mismatch this pairing exists to prevent.
    .replace(/['‘’‛ʼ′`´]/g, "")
    // Everything else that is not a letter, a digit or a space becomes a gap. \p{L}
    // and \p{N} rather than a-z0-9: an ASCII class would erase a Cyrillic or CJK
    // title down to the empty string, which matches everything or nothing.
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True if `guess` matches any accepted answer.
 *
 * Exact first: a guess that *is* an accepted answer always counts, however short.
 * Uploaders do add two-letter aliases ("HP"), and some titles are two letters
 * ("Up", "It") — the length guard below would make every one of them unwinnable.
 *
 * Then the fuzzy pair. Forward: the guess contains an accepted answer, so "it's
 * harry potter innit" counts. Reverse: an accepted answer contains the guess, for
 * typos and truncation — but only when the guess covers nearly the whole answer,
 * or a fragment like "the", "pot" or "wig" would score a win. That is what the
 * three-character floor protects, and it applies to substring matching only.
 */
export function isRight(guess: string, accepted: readonly string[]): boolean {
  const n = normalise(guess);
  if (!n) return false;

  if (accepted.some((raw) => normalise(raw) === n)) return true;

  if (n.length < 3) return false;
  return accepted.some((raw) => {
    const a = normalise(raw);
    if (!a) return false;
    return n.includes(a) || (n.length >= 6 && n.length >= a.length - 2 && a.includes(n));
  });
}
