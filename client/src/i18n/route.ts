import { type Lang, isLang, preferredLang } from "./lang";

/**
 * The language lives in the first path segment, and nowhere else.
 *
 * `/fr/2026-09-03`, `/en/calendar`, `/fr/booth`. Not a query string and not a
 * cookie: the two sides have different puzzles, so they are different pages, and
 * a link someone pastes into a group chat has to land the reader on the game the
 * sender was playing. That also makes them separately indexable, which a `?lang=`
 * would not.
 */

/**
 * Split a pathname into its side and the rest.
 *
 * `lang` is null when the path carries no side at all, which is the case for
 * every link that predates this change — `/`, `/calendar`, `/2026-09-03` — and
 * `redirectTarget` below decides where those go.
 */
export function splitLang(path: string): { lang: Lang | null; rest: string } {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  const slash = trimmed.indexOf("/");
  const head = slash === -1 ? trimmed : trimmed.slice(0, slash);
  if (!isLang(head)) return { lang: null, rest: trimmed };
  return { lang: head, rest: slash === -1 ? "" : trimmed.slice(slash + 1) };
}

/**
 * Where a path with no side in it should go, or null if it already has one.
 *
 * Two different rules, because the two cases mean different things:
 *
 * - **The bare root** is someone arriving with no opinion, so they get sorted:
 *   a remembered choice, else the browser's languages. This is the only place
 *   detection happens.
 * - **Any other unprefixed path** — `/calendar`, `/2026-09-03` — is a link from
 *   the era before the split, or a bookmark from it. Those are French by
 *   definition, whatever the browser says: every song and every stored round
 *   predating the split is on that side, so sending a returning French player to
 *   `/en` because their phone is in English would show them an empty calendar
 *   and someone else's tunes. Their history is the stronger signal than their
 *   locale, and it is French.
 */
export function redirectTarget(path: string, search = "", hash = ""): string | null {
  const { lang, rest } = splitLang(path);
  if (lang) return null;
  const side: Lang = rest === "" ? preferredLang() : "fr";
  return `/${side}${rest ? `/${rest}` : ""}${search}${hash}`;
}
