"""Answer normalization — the one function duplicated across two languages.

The API normalizes every accepted answer at ingest and stores both forms
(`accepted_answers` raw for display, `accepted_norm` for matching). The client
compares its own normalise(guess) against `accepted_norm` only.

Without this, an uploader typing "Hedwig's Theme " with a curly apostrophe and a
trailing space creates a puzzle no correct guess can ever match — the client
would be normalizing one side of the comparison and not the other.

This is a deliberate line-for-line transliteration of `normalise` in
client/src/game/match.ts. Every step below names its JavaScript counterpart, and
both are tested against tests/normalize_fixtures.json. If you change one, change
the other in the same commit.

Two places where the obvious Python is subtly *not* the same function, and so is
avoided here:

- `unicodedata.category(ch) == "Mn"` drops every combining mark. JavaScript's
  `[\\u0300-\\u036f]` drops only the Combining Diacritical Marks block, leaving
  e.g. Hebrew points alone. The block is what is implemented.
- `str.split()` uses Python's notion of whitespace, which differs from
  JavaScript's `\\s`. By the time whitespace is collapsed, every non-letter
  non-digit has already become an ASCII space, so splitting on " " is exact.

Deliberately *not* implemented, though PLAN.md lists it: dropping a leading
article. The client's matcher already compares substrings in both directions, so
"The Godfather" as a guess still finds "godfather" and vice versa — and an exact
mirror of the client is worth more than a rule that only one side would know.
"""

import unicodedata

# JS: .replace(/[̀-ͯ]/g, "")
_COMBINING = range(0x0300, 0x0370)

# JS: .replace(/['‘’‛ʼ′`´]/g, "")
_APOSTROPHES = "'‘’‛ʼ′`´"


def _is_letter_or_digit(ch: str) -> bool:
    """JS `\\p{L}` and `\\p{N}` are the Unicode General_Category groups L* and
    N*, which is exactly what the first letter of Python's category gives."""
    return unicodedata.category(ch)[0] in ("L", "N")


def normalize(s: str) -> str:
    """Lowercase, strip accents, drop apostrophes, gap everything else,
    collapse. Returns "" for input that normalizes away to nothing."""
    s = s.lower()                                   # JS: .toLowerCase()
    s = unicodedata.normalize("NFD", s)             # JS: .normalize("NFD")

    out = []
    for ch in s:
        if ord(ch) in _COMBINING or ch in _APOSTROPHES:
            continue                                # removed, not gapped
        out.append(ch if (_is_letter_or_digit(ch) or ch == " ") else " ")

    # JS: .replace(/\s+/g, " ").trim()
    return " ".join(part for part in "".join(out).split(" ") if part)


def normalize_all(answers: list[str]) -> list[str]:
    """Normalize a list, dropping empties and duplicates, order preserved.

    Deduplication is why `accepted_norm` may be shorter than
    `accepted_answers`: "Hedwig's Theme" and "Hedwigs Theme" collapse to one.
    """
    out: list[str] = []
    seen: set[str] = set()
    for a in answers:
        n = normalize(a)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out
