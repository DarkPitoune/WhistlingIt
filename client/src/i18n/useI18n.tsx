import { createContext, useContext, useMemo } from "react";
import { HTML_LANG, type Lang } from "./lang";
import { type Strings, stringsFor } from "./strings";

/**
 * The current side, and its words, for the screens.
 *
 * A context here and an argument everywhere else, which is not an inconsistency:
 *
 * - **The pool** — which songs, which daily, which streak — is threaded as a
 *   `Lang` argument through the api and storage layers, because a function that
 *   forgets it would read the wrong player's history and the type is what makes
 *   that a compile error. See the note at the top of `lang.ts`.
 * - **The words** are a rendering concern, and passing `t` down through Shell,
 *   Header, BackLink, Game, Daily, Reveal, Tape and Bar would be nine props deep
 *   for something no component ever varies.
 *
 * `lang` rides along on the context too, so a screen that needs to call the api
 * doesn't have to be handed the same value twice.
 *
 * There is no locale switching at runtime: the side is in the URL, so changing
 * it is a navigation. That means this value changes only when the whole app
 * remounts, and nothing here has to be reactive.
 */
export interface I18n {
  lang: Lang;
  t: Strings;
}

/*
 * No default. A screen rendered outside the provider would otherwise pick up
 * English silently on the French site, which is exactly the bug this file exists
 * to make impossible — so the hook throws instead.
 */
const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const value = useMemo<I18n>(() => ({ lang, t: stringsFor(lang) }), [lang]);

  // The head, corrected for the side actually on screen.
  //
  // The build already bakes the right values into /fr/index.html and
  // /en/index.html, so on a cold load this changes nothing. It earns its keep on
  // the two paths where the served document is not the one being rendered: a
  // deep link like /en/calendar, which GitHub Pages answers with 404.html — the
  // root document, which is French — and the reveal's cross-promo, which crosses
  // sides without a page load. `lang` decides screen-reader pronunciation and
  // whether the browser offers to translate, so it is not cosmetic.
  document.documentElement.lang = HTML_LANG[lang];
  document.title = value.t.htmlTitle;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", value.t.htmlDescription);
  // Every deep path credits its own language root, never the other one's. A
  // French dated round is served by 404.html, which is the English document.
  document.getElementById("canonical")?.setAttribute("href", `https://whistling.it/${lang}`);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside <I18nProvider>");
  return v;
}

/** Shorthand for the common case: only the words. */
export const useT = (): Strings => useI18n().t;
