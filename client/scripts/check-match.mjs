/**
 * Guess matching, both halves of src/game/match.ts.
 *
 * `normalise` here and `normalize()` in server/api/app/normalize.py must agree, or
 * a puzzle can ship with accepted answers no correct guess ever matches. Both read
 * the same fixture list; this script runs the JavaScript half.
 *
 *   node scripts/check-match.mjs          (or: npm run check:match)
 *   cd ../server/api && pytest            runs the Python half
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { acceptedFor, canonical, isRight, normalise } from "../src/game/match.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "../../server/api/tests/normalize_fixtures.json");

const { cases } = JSON.parse(readFileSync(fixtures, "utf8"));

let failed = 0;
for (const [raw, expected] of cases) {
  const got = normalise(raw);
  if (got !== expected) {
    failed++;
    console.error(`FAIL ${JSON.stringify(raw)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  }
  // The client normalises a stored answer again inside isRight, so the function
  // has to be a fixed point on its own output.
  const twice = normalise(got);
  if (twice !== got) {
    failed++;
    console.error(`NOT IDEMPOTENT ${JSON.stringify(raw)}: ${JSON.stringify(got)} -> ${JSON.stringify(twice)}`);
  }
}

console.log(`${cases.length - failed}/${cases.length} normalize fixtures pass (JS)`);

// ── isRight ───────────────────────────────────────────────────────────────────
// Answers as the server stores them: already through normalize().
const ANSWERS = ["hedwigs theme", "harry potter", "hedwig", "poudlard", "hp"];

const matches = [
  ["Hedwig's Theme",            true,  "the exact title, apostrophe and all"],
  ["hedwigs theme",             true,  "the stored form"],
  ["HP",                        true,  "a two-letter alias — exact hits skip the length floor"],
  ["hp",                        true,  "same, lowercased"],
  ["it's harry potter innit",   true,  "the guess contains an answer"],
  ["Harry Pott",                true,  "truncation covering nearly the whole answer"],
  ["Harry Poter",               false, "an internal typo is NOT caught — the reverse rule is\n                                        substring-only, so a dropped letter mid-word misses"],
  ["Poudlard !",                true,  "punctuation is a gap"],
  ["the",                       false, "a fragment must not win"],
  ["pot",                       false, "nor this one"],
  ["wig",                       false, "nor this one"],
  ["h",                         false, "a single letter"],
  ["",                          false, "nothing"],
  ["definitely not the answer", false, "an honest miss"],
];

let mFailed = 0;
for (const [guess, expected, why] of matches) {
  const got = isRight(guess, ANSWERS);
  if (got !== expected) {
    mFailed++;
    console.error(`FAIL isRight(${JSON.stringify(guess)}) === ${got}, expected ${expected} — ${why}`);
  }
}
console.log(`${matches.length - mFailed}/${matches.length} isRight cases pass`);

// ── the looser pass: filler words, plurals, and the artist ────────────────────
// Answers as the server stores them, for a series whose title carries both an
// article and a plural.
const SIMPSONS = ["the simpsons"];

const loose = [
  ["The Simpsons",   true,  "the title as stored"],
  ["Simpsons",       true,  "article dropped"],
  ["Simpson",        true,  "article dropped and the plural s with it"],
  ["The Simpson",    true,  "article kept, plural dropped"],
  ["the simpsons",   true,  "lowercased"],
  ["LES SIMPSON",    true,  "the French title — its article is filler too"],
  ["Simp",           false, "still a fragment"],
  ["The",            false, "filler alone must never win"],
  ["the the",        false, "nor filler twice, which canonicalises to nothing"],
  ["Futurama",       false, "an honest miss"],
];
let lFailed = 0;
for (const [guess, expected, why] of loose) {
  const got = isRight(guess, SIMPSONS);
  if (got !== expected) {
    lFailed++;
    console.error(`FAIL isRight(${JSON.stringify(guess)}, ["the simpsons"]) === ${got}, expected ${expected} — ${why}`);
  }
}
console.log(`${loose.length - lFailed}/${loose.length} filler/plural cases pass`);

// A name of nothing but filler has no canonical form. If that ever returns ""
// *and* a caller compares against it directly, every guess wins — so pin it.
let gFailed = 0;
for (const [input, expected, why] of [
  ["The The",            "",                  "all filler"],
  ["Les Choristes",      "choriste",          "French article and plural"],
  ["Pirates des Caraibes", "pirate caraibe",  "mid-title French preposition"],
  ["Boss",               "boss",              "double s is not a plural"],
  ["HP",                 "hp",                "too short to depluralise"],
]) {
  const got = canonical(input);
  if (got !== expected) {
    gFailed++;
    console.error(`FAIL canonical(${JSON.stringify(input)}) === ${JSON.stringify(got)}, expected ${JSON.stringify(expected)} — ${why}`);
  }
}
console.log(`${5 - gFailed}/5 canonical cases pass`);

// ── the artist counts, whatever the category ─────────────────────────────────
let aFailed = 0;
for (const [category, expected] of [["Music", true], ["Film", true], ["Jingle", true]]) {
  const list = acceptedFor({ accepted: ["the simpsons"], from: "Danny Elfman", category });
  const got = isRight("danny elfman", list);
  if (got !== expected) {
    aFailed++;
    console.error(`FAIL the artist should be accepted for ${category}`);
  }
}
console.log(`${3 - aFailed}/3 artist cases pass`);

if (lFailed || gFailed || aFailed) process.exitCode = 1;

process.exit(failed || mFailed ? 1 : 0);
