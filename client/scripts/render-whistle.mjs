/**
 * Renders the mock daily clip to a real audio file.
 *
 * The design page (../index.html) synthesises its whistle live in WebAudio. The app
 * plays a real recording instead, so this script bakes that same synth down to a WAV
 * offline — sine + 5.4 Hz vibrato + a bandpassed puff of breath on each attack.
 *
 * It writes two things:
 *   public/clips/hedwig.wav        the audio the client fetches
 *   src/api/fixtures/hedwig.json   the clip metadata, note boundaries included
 *
 * Replace both when you have real whistlers. The note boundaries in the fixture are
 * exact here because we generated the notes; for a real recording the booth's onset
 * detector produces them (see src/audio/onsets.ts).
 *
 * Usage: npm run clip
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const RATE = 44100;
const BEAT = 0.62;

/** Hedwig's Theme, 14 notes. Frequencies in Hz, durations in beats. */
const TUNE = [
  { f: 493.88, b: 1 }, { f: 659.25, b: 1.5 }, { f: 783.99, b: 0.5 }, { f: 739.99, b: 1 },
  { f: 659.25, b: 2 }, { f: 987.77, b: 1 }, { f: 880.0, b: 3 }, { f: 739.99, b: 3 },
  { f: 659.25, b: 1.5 }, { f: 783.99, b: 0.5 }, { f: 739.99, b: 1 }, { f: 622.25, b: 2 },
  { f: 698.46, b: 1 }, { f: 493.88, b: 3 },
];

// ── note boundaries ────────────────────────────────────────────────────────────
const dur = TUNE.map((n) => n.b * BEAT);
const start = [];
dur.reduce((acc, d, i) => { start[i] = acc; return acc + d; }, 0);
const end = start.map((s, i) => s + dur[i]);
const TOTAL = end[end.length - 1];

// ── a one-pole-free RBJ bandpass, for the breath noise ─────────────────────────
function bandpass(fc, q) {
  const w = (2 * Math.PI * fc) / RATE;
  const alpha = Math.sin(w) / (2 * q);
  const cw = Math.cos(w);
  const a0 = 1 + alpha;
  // constant 0 dB peak gain form, matching BiquadFilterNode's "bandpass"
  const b = [alpha / a0, 0, -alpha / a0];
  const a = [(-2 * cw) / a0, (1 - alpha) / a0];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

/** WebAudio's exponentialRampToValueAtTime, sampled at a point in the ramp. */
const expRamp = (v0, v1, p) => v0 * Math.pow(v1 / v0, Math.min(1, Math.max(0, p)));

// ── render ─────────────────────────────────────────────────────────────────────
const tail = 0.25;
const frames = Math.ceil((TOTAL + tail) * RATE);
const buf = new Float32Array(frames);

TUNE.forEach((note, i) => {
  const len = dur[i];
  const f = note.f;
  const prev = i > 0 ? TUNE[i - 1].f : f;
  const glide = Math.min(0.07, len * 0.4);
  const atk = Math.min(0.04, len * 0.25);
  const rel = Math.min(0.09, len * 0.35);
  const puff = Math.min(0.22, len);

  const bp = bandpass(f * 1.9, 1.4);
  let phase = 0;
  const n = Math.ceil((len + 0.05) * RATE);
  const at = Math.round(start[i] * RATE);

  for (let k = 0; k < n; k++) {
    const t = k / RATE;
    const out = at + k;
    if (out >= frames) break;

    // pitch: portamento from the previous note, then a vibrato around the target
    const base = i === 0 || t >= glide ? f : expRamp(prev, f, t / glide);
    const freq = base + Math.sin(2 * Math.PI * 5.4 * t) * f * 0.011;
    phase += (2 * Math.PI * freq) / RATE;

    // tone envelope
    let g;
    if (t < atk) g = expRamp(0.0001, 0.2, t / atk);
    else if (t < len - rel) g = 0.2;
    else if (t < len) g = expRamp(0.2, 0.0001, (t - (len - rel)) / rel);
    else g = 0;

    // breath envelope — a short puff on the attack only
    let ng;
    if (t < 0.02) ng = expRamp(0.0001, 0.018, t / 0.02);
    else if (t < puff) ng = expRamp(0.018, 0.0001, (t - 0.02) / (puff - 0.02));
    else ng = 0;

    buf[out] += Math.sin(phase) * g + bp(Math.random() * 2 - 1) * ng;
  }
});

// ── 16-bit mono WAV ────────────────────────────────────────────────────────────
const data = Buffer.alloc(frames * 2);
let peak = 0;
for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? Math.min(1, 0.89 / peak) : 1;
for (let i = 0; i < frames; i++) {
  const s = Math.max(-1, Math.min(1, buf[i] * norm));
  data.writeInt16LE(Math.round(s * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);          // PCM chunk size
header.writeUInt16LE(1, 20);           // format: PCM
header.writeUInt16LE(1, 22);           // channels
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);    // byte rate
header.writeUInt16LE(2, 32);           // block align
header.writeUInt16LE(16, 34);          // bits per sample
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

const wavPath = join(ROOT, "public/clips/hedwig.wav");
mkdirSync(dirname(wavPath), { recursive: true });
writeFileSync(wavPath, Buffer.concat([header, data]));

// ── the fixture the mock API serves ────────────────────────────────────────────
const round = (n) => Number(n.toFixed(3));
const fixture = {
  id: "hedwig",
  date: "2026-08-27",
  audioUrl: "/clips/hedwig.wav",
  duration: round(TOTAL + tail),
  noteStarts: start.map(round),
  noteEnds: end.map(round),
  category: "Film",
  difficulty: "Tricky",
  avgSolveLevel: 2,
  // Plausible crowd figures, so the fixture exercises the percentage branch of
  // solveRate() rather than only the "nobody has played" one.
  solvedCount: 37,
  failedCount: 23,
  signature: "Téo",
  title: "Hedwig's Theme",
  from: "Harry Potter · John Williams",
  accepted: ["harry potter", "hedwig", "hedwigs theme", "poudlard", "hp"],
};

const jsonPath = join(ROOT, "src/api/fixtures/hedwig.json");
mkdirSync(dirname(jsonPath), { recursive: true });
writeFileSync(jsonPath, JSON.stringify(fixture, null, 2) + "\n");

console.log(`wrote ${wavPath} — ${TUNE.length} notes, ${TOTAL.toFixed(2)}s, ${(data.length / 1024).toFixed(0)} KiB`);
console.log(`wrote ${jsonPath}`);
