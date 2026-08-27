/**
 * Note detection for the booth.
 *
 * The design's rule is that detection *reports*, it doesn't ask — the whistler sees
 * "14 notes found" on the same bar the game uses and either accepts it or adjusts.
 * So this only has to be right often enough to be checkable at a glance.
 *
 * Whistling is monophonic with real gaps between notes, so a hysteresis gate on the
 * energy envelope gets most of the way there. It will merge two notes slurred at the
 * same pitch — that's the known failure, and it's the one the "Adjust" button exists
 * for. Pitch tracking would catch it; it isn't worth the complexity until we see how
 * people actually whistle.
 */

const FRAME = 1024;
const HOP = 256;
const MIN_NOTE = 0.06;  // seconds — shorter than this is a click, not a note
const MIN_GAP = 0.04;   // seconds — a shorter dip is one note, not two

export interface Detection {
  starts: number[];
  ends: number[];
  /** How cleanly the notes separated from the noise floor. Drives the badge. */
  confidence: "Confident" | "Rough";
}

function percentile(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i] ?? 0;
}

export function detectNotes(buffer: AudioBuffer): Detection {
  const rate = buffer.sampleRate;
  const pcm = buffer.getChannelData(0);
  const hops = Math.max(0, Math.floor((pcm.length - FRAME) / HOP) + 1);
  if (hops < 2) return { starts: [], ends: [], confidence: "Rough" };

  // ── energy envelope ────────────────────────────────────────────────────────
  const env = new Float32Array(hops);
  for (let h = 0; h < hops; h++) {
    let sum = 0;
    const base = h * HOP;
    for (let i = 0; i < FRAME; i++) {
      const s = pcm[base + i] ?? 0;
      sum += s * s;
    }
    env[h] = Math.sqrt(sum / FRAME);
  }

  const sorted = Float32Array.from(env).sort();
  const floor = percentile(sorted, 0.1);
  const peak = percentile(sorted, 0.95);
  const range = peak - floor;
  if (range < 1e-4) return { starts: [], ends: [], confidence: "Rough" };

  // Asymmetric thresholds: harder to start a note than to stay in one, so vibrato
  // dipping through the gate doesn't chop a held note into three.
  const on = floor + range * 0.16;
  const off = floor + range * 0.08;

  // ── hysteresis gate ────────────────────────────────────────────────────────
  // A frame only crosses the threshold once the attack is already underway, so a
  // frame's centre reports the note late. Take the leading edge for onsets and the
  // trailing edge for offsets: each note comes out slightly wide, which is the safe
  // direction — a level never cuts off the note it just bought.
  const tOn = (h: number) => (h * HOP) / rate;
  const tOff = (h: number) => (h * HOP + FRAME) / rate;
  const starts: number[] = [];
  const ends: number[] = [];
  let inNote = false;

  for (let h = 0; h < hops; h++) {
    const e = env[h] ?? 0;
    if (!inNote && e > on) { starts.push(tOn(h)); inNote = true; }
    else if (inNote && e < off) { ends.push(tOff(h)); inNote = false; }
  }
  if (inNote) ends.push(buffer.duration);

  // ── clean up ───────────────────────────────────────────────────────────────
  const s: number[] = [];
  const e: number[] = [];
  for (let i = 0; i < starts.length; i++) {
    const a = starts[i] as number;
    const b = ends[i] as number;
    const prevEnd = e[e.length - 1];
    if (prevEnd !== undefined && a - prevEnd < MIN_GAP) {
      e[e.length - 1] = b;          // gap too short — same note
    } else if (b - a >= MIN_NOTE) {
      s.push(a);
      e.push(b);
    }
  }

  // Confident when the notes stand well clear of the floor and we found a
  // plausible number of them for a 10–30 second hum.
  const clean = peak > floor * 6 && range > 0.01;
  return {
    starts: s,
    ends: e,
    confidence: clean && s.length >= 4 && s.length <= 60 ? "Confident" : "Rough",
  };
}
