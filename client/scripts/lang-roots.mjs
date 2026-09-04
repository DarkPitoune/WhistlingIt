/**
 * Turn the one built document into the site's real shape: a 404 fallback and a
 * static, correctly-worded index.html for each language.
 *
 *   dist/index.html   the root, which redirects on load
 *   dist/404.html     every client-side route, rendered by the app
 *   dist/fr/index.html, dist/en/index.html
 *
 * Why bake instead of letting the app fix the head after it mounts:
 *
 * - An unfurler — Slack, iMessage, WhatsApp, Facebook — reads the raw bytes and
 *   never runs the bundle. A pasted /fr link would unfurl in English forever.
 * - `/fr` and `/en` are the URLs the sitemap lists and the ones people share.
 *   Served through 404.html they would render perfectly and answer with a 404
 *   *status*, which is what keeps a page out of an index. A file makes them 200.
 *
 * The copy comes from src/i18n/strings.ts, not from a table here, so the title
 * a crawler sees and the title the app sets are the same string by construction.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/lang-roots.mjs
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LANGS, HTML_LANG } from "../src/i18n/lang.ts";
import { stringsFor } from "../src/i18n/strings.ts";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const SITE = "https://whistling.it";

/** Open Graph wants a full locale, not a bare language. */
const OG_LOCALE = { fr: "fr_FR", en: "en_US" };

/**
 * Replace an attribute's value on the one tag matched by `pattern`.
 *
 * Deliberately a narrow regex over a parser: this runs on Vite's own output,
 * which is the input document with the script tags rewritten, so every tag it
 * touches is one written by hand in index.html a few lines from here. A miss is
 * loud rather than silent — `swap` throws — which is the property that matters,
 * because the failure being guarded against is shipping the French description
 * on the English page and never noticing.
 */
function swap(html, pattern, replacement) {
  let hit = 0;
  const out = html.replace(pattern, (...m) => {
    hit += 1;
    return replacement(...m);
  });
  if (hit !== 1) {
    throw new Error(`lang-roots: expected 1 match for ${pattern}, found ${hit}. index.html changed?`);
  }
  return out;
}

const escape = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function localise(html, lang) {
  const t = stringsFor(lang);
  const url = `${SITE}/${lang}`;

  let out = swap(html, /(<html[^>]*\blang=")[^"]*(")/, (_, a, b) => a + HTML_LANG[lang] + b);
  out = swap(out, /(<title>)[\s\S]*?(<\/title>)/, (_, a, b) => a + escape(t.htmlTitle) + b);
  out = swap(
    out,
    /(<meta name="description" content=")[^"]*(")/,
    (_, a, b) => a + escape(t.htmlDescription) + b,
  );
  out = swap(out, /(<link rel="canonical"[^>]*href=")[^"]*(")/, (_, a, b) => a + url + b);
  out = swap(out, /(<meta property="og:url" content=")[^"]*(")/, (_, a, b) => a + url + b);
  out = swap(
    out,
    /(<meta property="og:title" content=")[^"]*(")/,
    (_, a, b) => a + escape(t.htmlTitle) + b,
  );
  out = swap(
    out,
    /(<meta property="og:description" content=")[^"]*(")/,
    (_, a, b) => a + escape(t.htmlDescription) + b,
  );
  out = swap(
    out,
    /(<meta property="og:locale" content=")[^"]*(")/,
    (_, a, b) => a + OG_LOCALE[lang] + b,
  );
  return out;
}

const root = await readFile(join(DIST, "index.html"), "utf8");

// The fallback stays as built: it stands in for paths on both sides, so there
// is no right language to bake into it. I18nProvider fixes the head from the
// URL as soon as the bundle runs, which is the best that can be done for a
// document that has to serve /fr/calendar and /en/booth alike.
await writeFile(join(DIST, "404.html"), root);

for (const lang of LANGS) {
  await mkdir(join(DIST, lang), { recursive: true });
  await writeFile(join(DIST, lang, "index.html"), localise(root, lang));
}

console.info(`lang-roots: wrote 404.html and ${LANGS.map((l) => `${l}/index.html`).join(", ")}`);
