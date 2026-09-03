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
/**
 * Words that vary in how a title gets written, and so must not decide a match.
 *
 * Articles and the two "and"/"of" constructions, in English and French — the
 * audience is French and the pool is bilingual ("Pirates des Caraïbes", "Vive le
 * vent"), so an English-only list would miss most of it.
 *
 * Deliberately *not* a retrieval stop-word list. The standard Snowball/NLTK
 * English set is 127 words and includes `it`, `be`, `my`, `not`, `all`, `that`,
 * `who` — which are load-bearing in titles. Under that list "That's All" and "It"
 * both canonicalise to the empty string, and an empty answer matches every guess.
 * These are only the words a person genuinely drops or adds when typing a name.
 */
const FILLER = new Set([
  // English
  "a", "an", "the", "and", "of",
  // French
  "le", "la", "les", "l", "un", "une", "des", "du", "de", "d", "et", "au", "aux",
]);

/** Strip a plural "s" so "Simpson" and "Simpsons" are the same word. */
function singular(word: string): string {
  // Four characters, so "les" and "hp" survive; not "ss", so "boss" is not "bos".
  if (word.length < 4 || !word.endsWith("s") || word.endsWith("ss")) return word;
  return word.slice(0, -1);
}

/**
 * A looser form for comparison: normalised, minus filler words, minus plural "s".
 *
 * "The Simpsons", "Simpsons", "Simpson" and "The Simpson" all reduce to
 * "simpson". Layered on top of `normalise` rather than folded into it, because
 * that function is pinned to the Python at ingest by a shared fixture list and
 * must keep producing exactly what is stored.
 *
 * Returns "" for a name made only of filler — "The The" — and every caller has to
 * treat that as "no canonical form" rather than as a match-anything wildcard.
 */
export function canonical(s: string): string {
  return normalise(s)
    .split(" ")
    .filter((w) => w && !FILLER.has(w))
    .map(singular)
    .join(" ");
}

/**
 * The accepted list a clip should actually be judged against.
 *
 * `from` is a free-text credit line — "Harry Potter · John Williams", or just
 * "Danny Elfman" — so it is split on its separators and each part offered on its
 * own. Parts under three characters are dropped; `isRight` would reject them
 * anyway, and a stray initial should never win.
 *
 * Offered for every category. It used to be films and series only, on the grounds
 * that a composer is a route to the answer while a pop artist is trivia — but
 * naming the artist of a tune you have just heard whistled is recognising it, and
 * that is what the box is asking.
 */
export function acceptedFor(clip: {
  accepted: readonly string[];
  from?: string | null;
  category?: string | null;
}): string[] {
  const base = [...clip.accepted];
  if (!clip.from) return base;

  const seen = new Set(base.map(normalise));
  for (const part of clip.from.split(/[·,;|]|\s+\/\s+|\s+—\s+/)) {
    const credit = part.trim();
    if (credit.length < 3) continue;
    const key = normalise(credit);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    base.push(credit);
  }
  return base;
}

export function isRight(guess: string, accepted: readonly string[]): boolean {
  const n = normalise(guess);
  if (!n) return false;

  // Exact, on either form. The canonical pass is what lets "Simpson" answer
  // "The Simpsons"; it runs before the length floor for the same reason the
  // literal pass does — a two-letter title should not be unwinnable.
  const g = canonical(guess) || n;
  if (accepted.some((raw) => {
    const a = normalise(raw);
    return a === n || (canonical(raw) || a) === g;
  })) return true;

  if (n.length < 3) return false;
  return accepted.some((raw) => {
    const a = normalise(raw);
    if (!a) return false;
    if (fuzzy(n, a)) return true;
    // `|| a` matters: a name of nothing but filler has no canonical form, and
    // comparing against "" would make it match anything at all.
    return fuzzy(g, canonical(raw) || a);
  });
}

/**
 * Forward: the guess contains an answer, so "it's harry potter innit" counts.
 * Reverse: an answer contains the guess, for typos and truncation — but only when
 * the guess covers nearly the whole answer, or "the", "pot" or "wig" would win.
 */
function fuzzy(guess: string, answer: string): boolean {
  return (
    guess.includes(answer) ||
    (guess.length >= 6 && guess.length >= answer.length - 2 && answer.includes(guess))
  );
}
