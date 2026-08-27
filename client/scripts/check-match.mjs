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
import { isRight, normalise } from "../src/game/match.ts";

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

process.exit(failed || mFailed ? 1 : 0);
