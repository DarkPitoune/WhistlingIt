/**
 * Walks a whole round against a real backend — no browser, no mock.
 *
 * This is the check that the play flow works end to end: it calls the same RPC
 * the app calls, maps the payload with the app's own `toClip`, derives the ladder
 * with the app's own `makeLadder`/`unlockedSeconds`, matches guesses with the
 * app's own `isRight`, and fetches the audio bytes the player would decode.
 *
 *   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… node scripts/check-play-flow.mjs
 *
 * With no arguments it reads .env.local, so after `supabase start` in ../server
 * this is a one-word check.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { difficultyFor } from "../src/game/difficulty.ts";
import { makeLadder, notesAtLevel, unlockedSeconds } from "../src/game/levels.ts";
import { isRight } from "../src/game/match.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** .env.local, unless the environment already says otherwise. */
function loadEnvLocal() {
  if (process.env.VITE_SUPABASE_URL) return;
  try {
    for (const line of readFileSync(resolve(here, "../.env.local"), "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env.local; the environment has to carry the values */
  }
}
loadEnvLocal();

// Imported dynamically, and only after the environment is in place: live.ts reads
// its config at module scope, and a static import would be evaluated before
// loadEnvLocal() had run.
const { toClip } = await import("../src/api/live.ts");

const URL_ = (process.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.VITE_SUPABASE_ANON_KEY ?? "";
if (!URL_ || !KEY) {
  console.error("set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or fill .env.local)");
  process.exit(2);
}

let failed = 0;
const ok = (cond, label, detail = "") => {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failed++;
};

// ── 1. the one call the game makes ────────────────────────────────────────────
const res = await fetch(`${URL_}/rest/v1/rpc/get_daily`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: "{}",
});
ok(res.ok, `POST /rest/v1/rpc/get_daily`, `HTTP ${res.status}`);
if (!res.ok) process.exit(1);

const row = await res.json();
if (row === null) {
  console.log("\n  get_daily() returned null — the pool is empty, so there is no round to walk.");
  console.log("  Upload a whistle through the booth, or run ../server/supabase/seed.sql locally.");
  process.exit(1);
}

// ── 2. the app's own mapping ──────────────────────────────────────────────────
const clip = toClip(row);
const _ladder = makeLadder(clip.noteStarts.length);
console.log(`\n${clip.title} — ${clip.from || "(no from line)"}  [${clip.category} · ${difficultyFor(_ladder, clip.avgSolveLevel)}]`);
console.log(`${clip.noteStarts.length} notes, ${clip.duration}s, starts at ${clip.startAt}s\n`);

ok(clip.noteStarts.length > 0, "note boundaries present");
ok(clip.noteStarts.length === clip.noteEnds.length, "starts and ends are the same length");
ok(clip.accepted.length > 0, "accepted answers present");
ok(clip.duration > 0, "duration is positive");
ok(
  clip.avgSolveLevel >= 1 && clip.avgSolveLevel <= makeLadder(clip.noteStarts.length).length,
  "avgSolveLevel indexes the ladder",
  `level ${clip.avgSolveLevel} of ${makeLadder(clip.noteStarts.length).length}`,
);
// The whole point of scoring rungs: the crowd marker must land on a rung.
{
  const ladder = makeLadder(clip.noteStarts.length);
  const notes = notesAtLevel(ladder, clip.avgSolveLevel);
  ok(ladder.includes(notes), "the average lands on a real level", `${notes} notes`);
}
ok(clip.startAt >= 0 && clip.startAt < clip.duration, "startAt is inside the clip");
ok(
  clip.noteStarts.every((t, i) => i === 0 || t >= clip.noteStarts[i - 1]),
  "note starts ascend",
);

// ── 3. the ladder, rung by rung ───────────────────────────────────────────────
const ladder = makeLadder(clip.noteStarts.length);
console.log(`\nladder: ${ladder.join(" · ")}`);
let previous = 0;
for (const rung of ladder) {
  const open = unlockedSeconds(clip, rung);
  const playable = open - clip.startAt;
  ok(
    open > previous && playable > 0.05,
    `rung ${String(rung).padStart(2)} unlocks ${open.toFixed(2)}s`,
    `${playable.toFixed(2)}s playable`,
  );
  previous = open;
}
ok(
  Math.abs(unlockedSeconds(clip, ladder.at(-1)) - clip.noteEnds.at(-1)) < 1e-6,
  "the last rung reaches the last note's end",
);

// ── 4. guess matching, against what the server actually stored ────────────────
console.log("");
ok(isRight(clip.title, clip.accepted), `the title itself is a winning guess`, clip.title);
ok(
  clip.accepted.every((a) => isRight(a, clip.accepted)),
  "every stored answer is a winning guess",
);
ok(!isRight("definitely not the answer", clip.accepted), "a wrong guess loses");
ok(!isRight("a", clip.accepted), "a one-letter guess loses");

// ── 5. the bytes the player decodes ───────────────────────────────────────────
const audio = await fetch(clip.audioUrl);
ok(audio.ok, `GET the audio`, `HTTP ${audio.status} ${audio.headers.get("content-type")}`);
ok(
  audio.headers.get("access-control-allow-origin") === "*",
  "audio is CORS-readable (decodeAudioData needs it)",
);
const bytes = await audio.arrayBuffer().catch(() => null);
ok((bytes?.byteLength ?? 0) > 1024, "audio has bytes", `${bytes?.byteLength ?? 0}`);

console.log(failed ? `\n${failed} check(s) failed` : `\nplay flow ok`);
process.exit(failed ? 1 : 0);
