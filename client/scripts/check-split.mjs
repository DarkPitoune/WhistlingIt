/**
 * The two halves of the language split that have no UI to catch them.
 *
 * - `migrateToFrench` in src/game/storage.ts, which runs exactly once on every
 *   existing player's device and can only be got wrong once. A player whose
 *   streak does not survive the deploy has no way to complain that gets it back.
 * - `splitLang` / `redirectTarget` in src/i18n/route.ts, which decide where a
 *   bare URL lands. Every old link in the wild — a shared date, a bookmarked
 *   /booth — arrives through here.
 *
 * Both are pure given a localStorage, so this drives the app's real modules
 * against a stub of one rather than a copy of the logic.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/check-split.mjs
 *   (or: npm run check:split)
 */

/** Just enough of the Storage interface for storage.ts and lang.ts. */
class MemStorage {
  #m = new Map();
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(k, String(v)); }
  removeItem(k) { this.#m.delete(k); }
  clear() { this.#m.clear(); }
  keys() { return [...this.#m.keys()].sort(); }
}

globalThis.localStorage = new MemStorage();

// preferredLang() reads `navigator.languages` when nothing is remembered. Node
// ships its own `navigator` as a getter-only property, so it has to be redefined
// rather than assigned; `setLanguages` is how the cases below vary it.
let LANGUAGES = ["en-US"];
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  get: () => ({ languages: LANGUAGES, language: LANGUAGES[0] }),
});
const setLanguages = (...tags) => { LANGUAGES = tags; };

const store = globalThis.localStorage;
const { loadRounds, loadResults, loadStreak } = await import("../src/game/storage.ts");
const { splitLang, redirectTarget } = await import("../src/i18n/route.ts");
const { preferredLang, rememberLang } = await import("../src/i18n/lang.ts");

let failed = 0;
const ok = (cond, label, detail = "") => {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failed++;
};
const eq = (a, b, label) =>
  ok(JSON.stringify(a) === JSON.stringify(b), label, JSON.stringify(a) === JSON.stringify(b) ? "" : `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/** A device as it looked the moment before the split shipped. */
function preSplitDevice(entries) {
  store.clear();
  for (const [k, v] of Object.entries(entries)) store.setItem(k, JSON.stringify(v));
}

const round = (date, won) => ({
  date, clipId: `clip-${date}`, level: 3, tape: ["wrong", "win"], guesses: ["nope"],
  done: { won },
});

// ── the migration ─────────────────────────────────────────────────────────────
console.log("\nmigrating a pre-split device");
{
  preSplitDevice({
    "whistlingit.rounds": { "2026-09-01": round("2026-09-01", true), "2026-09-02": round("2026-09-02", false) },
    "whistlingit.streak": { count: 4, lastWon: "2026-09-03" },
    "whistlingit.backfilled": true,
  });

  const fr = loadRounds("fr");
  eq(Object.keys(fr).sort(), ["2026-09-01", "2026-09-02"], "the old rounds land on the French side");
  eq(loadResults("fr"), { "2026-09-01": true, "2026-09-02": false }, "wins and losses both survive");
  eq(loadRounds("en"), {}, "English starts empty");

  ok(store.getItem("whistlingit.rounds") !== null, "the pre-split key is left in place (rollback keeps working)");
  ok(store.getItem("whistlingit.backfilled.fr") === "true", "the backfill flag comes across, so the streak walk cannot re-run");
  ok(store.getItem("whistlingit.backfilled.en") === "true", "English gets its own flag from its own empty walk");
}

console.log("\nthe pre-calendar single-round key");
{
  preSplitDevice({
    "whistlingit.round": round("2026-08-20", true),
    "whistlingit.backfilled": true,
  });
  eq(Object.keys(loadRounds("fr")), ["2026-08-20"], "the one overwritten round is folded in");
}
{
  // Both keys hold the same date. The map is the one we watched every day.
  preSplitDevice({
    "whistlingit.rounds": { "2026-08-20": round("2026-08-20", false) },
    "whistlingit.round": round("2026-08-20", true),
    "whistlingit.backfilled": true,
  });
  eq(loadResults("fr"), { "2026-08-20": false }, "the rounds map wins over the single key on a clash");
}

console.log("\nthe streak crosses, and only onto French");
{
  preSplitDevice({ "whistlingit.streak": { count: 4, lastWon: "2026-09-03" }, "whistlingit.backfilled": true });
  // Any read triggers the copy; loadStreak only reports a run that could still
  // be extended, so assert the stored record rather than today's live number,
  // which depends on the clock.
  loadStreak("fr");
  eq(JSON.parse(store.getItem("whistlingit.streak.fr")), { count: 4, lastWon: "2026-09-03" }, "the French streak is the old one");
  ok(store.getItem("whistlingit.streak.en") === null, "English has no streak to inherit");
  ok(loadStreak("en") === 0, "and reads as zero");
}

console.log("\nrunning twice changes nothing");
{
  preSplitDevice({ "whistlingit.streak": { count: 4, lastWon: "2026-09-03" }, "whistlingit.backfilled": true });
  loadRounds("fr");
  // A win recorded after the migration must not be undone by a second copy.
  store.setItem("whistlingit.streak.fr", JSON.stringify({ count: 5, lastWon: "2026-09-04" }));
  loadRounds("fr");
  eq(JSON.parse(store.getItem("whistlingit.streak.fr")), { count: 5, lastWon: "2026-09-04" }, "the second pass does not overwrite newer progress");
}

console.log("\na device with nothing on it");
{
  store.clear();
  eq(loadRounds("fr"), {}, "no rounds");
  ok(store.getItem("whistlingit.rounds.fr") === null, "and no empty keys written");
}

// ── the routes ────────────────────────────────────────────────────────────────
console.log("\nreading the side out of a path");
for (const [path, want] of [
  ["/fr", { lang: "fr", rest: "" }],
  ["/en/", { lang: "en", rest: "" }],
  ["/fr/calendar", { lang: "fr", rest: "calendar" }],
  ["/en/2026-09-03", { lang: "en", rest: "2026-09-03" }],
  ["/", { lang: null, rest: "" }],
  ["/booth", { lang: null, rest: "booth" }],
  ["/2026-09-03", { lang: null, rest: "2026-09-03" }],
  // A song title is not a language.
  ["/french", { lang: null, rest: "french" }],
]) {
  eq(splitLang(path), want, `splitLang(${path})`);
}

console.log("\nwhere an un-prefixed link lands");
{
  store.clear();
  setLanguages("fr-FR", "fr");
  ok(preferredLang() === "fr", "a French browser prefers French");
  eq(redirectTarget("/"), "/fr", "the root follows the browser");

  setLanguages("de-DE");
  eq(redirectTarget("/"), "/en", "anything else gets English");

  rememberLang("fr");
  eq(redirectTarget("/"), "/fr", "a remembered choice beats the browser");

  store.clear();
  setLanguages("de-DE");
  // Every deep link that predates the split was a French one, whoever clicks it.
  eq(redirectTarget("/2026-09-03"), "/fr/2026-09-03", "an old dated link stays French for a German browser");
  eq(redirectTarget("/calendar"), "/fr/calendar", "so does the archive");
  eq(redirectTarget("/booth"), "/fr/booth", "and the booth");

  // The caller passes location.pathname, which never carries either of these.
  // Still German with nothing remembered, so this lands on English.
  eq(redirectTarget("/", "?x=1", "#top"), "/en?x=1#top", "the query and hash ride along");
  ok(redirectTarget("/fr/calendar") === null, "a path that already names a side is left alone");
  ok(redirectTarget("/en") === null, "including a bare language root");
}

console.log(failed ? `\n${failed} failed` : "\nsplit ok");
process.exit(failed ? 1 : 0);
