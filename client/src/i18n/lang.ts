/**
 * Which of the two games you are playing.
 *
 * Not a locale and not a preference: it is the pool. `fr` and `en` have separate
 * song catalogues, separate dailies, separate calendars and separate streaks, and
 * the only thing they share is the code. So this is threaded through as an
 * argument almost everywhere rather than read from a context or a global — a
 * function that touches a puzzle, a round or a stored key has to say which side
 * it means, and the type is what makes forgetting a compile error.
 *
 * Kept in its own module, free of React and of the string tables, so the storage
 * and api layers can depend on it without pulling in the dictionary.
 */
export type Lang = "fr" | "en";

export const LANGS: readonly Lang[] = ["fr", "en"];

export const isLang = (v: unknown): v is Lang => v === "fr" || v === "en";

/** The other one. There are two, so this is total. */
export const otherLang = (l: Lang): Lang => (l === "fr" ? "en" : "fr");

/**
 * What each side calls itself, in itself.
 *
 * Always endonyms — "Français", never "French". The label's whole job is to be
 * recognised by someone who does not read the language it is written beside.
 */
export const LANG_NAME: Record<Lang, string> = {
  fr: "Français",
  en: "English",
};

/** For the `lang` attribute and `hreflang`. Same strings, named for their use. */
export const HTML_LANG: Record<Lang, string> = {
  fr: "fr",
  en: "en",
};

/** Storage key for the last side played. See `preferredLang`. */
const PICKED_KEY = "whistlingit.lang";

/**
 * Which side to send someone who arrived without saying.
 *
 * Order matters. A remembered choice beats the browser, because it is the only
 * signal that came from the person rather than from their device — someone whose
 * phone is in English and who plays the French game should not be re-sorted every
 * time they open a bare link.
 *
 * The browser check is a prefix match on the whole list rather than on
 * `navigator.language` alone: "fr-CA" has to count, and a device whose first
 * language is unsupported may still name French second.
 */
export function preferredLang(): Lang {
  try {
    const saved = localStorage.getItem(PICKED_KEY);
    if (isLang(saved)) return saved;
  } catch { /* private mode: fall through to the browser */ }

  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const base = (tag ?? "").toLowerCase().split("-")[0];
    if (base === "fr") return "fr";
    if (base === "en") return "en";
  }
  // English is the wider net for someone whose device says neither.
  return "en";
}

/** Remember the side, so a later bare link doesn't re-sort them. */
export function rememberLang(l: Lang): void {
  try { localStorage.setItem(PICKED_KEY, l); } catch { /* not fatal */ }
}
