# whistle-pipeline

> This was a standalone research repo. It now lives in `whistle/` inside
> `server/api`, and the backend integration sketched at the bottom of this file
> is implemented next door in `app/`. Kept as-is for one reason: everything
> below the "Verified on real audio" heading is **measured**, and those numbers
> are why the thresholds in `whistle/config.py` are what they are. Read
> `CLAUDE.md` for how to work on it; read this for the evidence.
>
> Paths written `src/whistle/x.py` below are now `whistle/x.py`.

Takes an audio recording of someone whistling a melody, returns **note-event
timestamps**. That is the whole scope: no API, no UI, no song identification.

```
audio file -> ffmpeg decode -> band-pass -> f0 per frame -> contour cleanup
           -> plateau segmentation -> note events + quality gate
```

## Setup

```sh
uv sync                                   # creates .venv, installs deps
uv run pytest -q tests/test_synthetic.py  # 14 known-answer tests
uv run whistle synth --out samples/synthetic.wav
uv run whistle analyze samples/synthetic.wav --plot
```

Requires `ffmpeg` on PATH (`brew install ffmpeg`). Python pinned to 3.12.

## Usage

```sh
uv run whistle analyze FILE [--plot] [--json]   # one file, table or JSON
uv run whistle batch samples/ [--plot] [--json] # whole folder, keeps going on errors
uv run whistle slice FILE -n 2                  # export the "first N notes" reveal
uv run whistle synth --out samples/x.wav        # known-answer test signal
```

Every field of `Params` is exposed as a CLI flag, so thresholds can be swept
without editing code:

```sh
uv run whistle analyze FILE --jump-cents 55 --hold-ms 40 --frame-size 512 --plot
```

`--plot` writes `out/<name>.png`: cleaned f0 contour, the smoothed contour the
segmenter actually decides on, detected notes, unvoiced regions shaded, and
level/purity underneath. This is the debugging tool — look at it first.

## Why it is built this way

**Whistling has no attack transient.** There is no pluck, no consonant, no
percussive burst, so spectral-flux / energy-novelty onset detection (the
standard approach, e.g. `librosa.onset_detect`) cannot work. Boundaries are
found instead as transitions between *plateaus of stable pitch*. Everything in
`segment.py` follows from that.

**A whistle is very nearly a pure sine.** The second partial is typically
25–40 dB down. So an FFT magnitude peak with parabolic interpolation is
competitive with YIN/pYIN/CREPE here, and it keeps numba and torch out of the
deployment image — runtime deps are numpy + scipy only. Measured worst-case
pitch error on synthetic tones across 600–3200 Hz: **0.6 cents**. If real
recordings show octave errors, `pyin` or `praat-parselmouth` are the fallbacks.

**Note names are not an output.** The game reveals audio ranges; it never needs
to know a note was C♯. Dropping that removes key detection, tuning-offset
estimation and semitone quantization from the pipeline — which is exactly where
off-key whistlers (i.e. everyone) would otherwise break it. `midi` appears in
the JSON only as a log transform of `f0_hz`; no key or tuning decision is made.

**Pitch is measured on the raw contour, smoothing is decision-only.** The
segmenter smooths to reject vibrato, but each note's `f0_hz` is the median of
the *unsmoothed* contour over the segment interior with `edge_trim_ms` cut from
each end, so smoothing never contaminates the reported value and glides are
excluded.

**Timestamps are not shifted.** The band-pass is zero-phase (`sosfiltfilt`) and
analysis frames are centred, not left-aligned.

## Output

```json
{
  "pipeline_version": "0.1.0",
  "params_fingerprint": "a1b2c3d4e5f6",
  "metrics": { "duration_s": 3.75, "voiced_ratio": 0.911,
               "whistle_likeness": 0.999, "clip_ratio": 0.0,
               "median_f0_hz": 1775.6 },
  "quality": { "ok": true, "reasons": [] },
  "n_notes": 5,
  "notes": [
    { "index": 0, "start_s": 0.138, "end_s": 0.821, "duration_s": 0.683,
      "f0_hz": 1571.7, "midi": 91.02, "confidence": 0.96, "level_db": -2.1 }
  ]
}
```

## Quality gate and anti-cheat

`whistle_likeness` is the share of band-limited energy sitting at f0. One number
does three jobs:

| signal | expected |
|---|---|
| clean whistle | > 0.9 |
| humming / singing (rich harmonics) | markedly lower |
| an actual studio recording of the song | very low |

That last row is the anti-cheat: someone uploading the real track instead of
whistling. `quality.reasons` is machine-readable (`not_whistle_like`,
`too_few_notes`, `clipping`, …) so a client can explain the rejection.

### Artifact rejection

Separately from the upload gate, individual *notes* are dropped when they are
both far quieter than the rest of the clip and impure. Real recordings produce
stable-pitch plateaus that are not notes: breath noise, and the whistle's onset
ramp where the tracker locks onto a weak low resonance before the tone
establishes. Measured on `teo.ogg`:

| | level vs 75th-pct note | purity |
|---|---|---|
| real notes | −6 … +6 dB | 0.93–1.00 |
| artifacts | **−13 … −22 dB** | 0.61–0.85 |

Both conditions must hold (`note_level_drop_db`, `note_min_confidence`), so a
genuinely soft phrase-ending survives on its purity and a loud noisy note
survives on its level. The reference is the 75th percentile of note levels, not
the median, so a clip carrying many artifacts cannot drag the reference down
between the two clusters — on `teo.ogg` the median left only 1.1 dB of margin
where the 75th percentile leaves 3.1 dB on both sides.

This removed 7 of 28 detections on `teo.ogg`, leaving 21 with a 7.4 dB gap
between the clusters. `test_quiet_impure_fragment_is_dropped` asserts the
fragment *does* leak through with the gate disabled, so it cannot silently
become a vacuous test.

**All gate thresholds in `config.py` marked `q_*` are placeholders.** They have
only been checked against synthetic signals. The gate always reports the
measured values next to the verdict so they can be calibrated against real
uploads — that is the first job once real recordings exist.

## Verified on real audio

`teo.ogg` (9.9 s, opus, mono 48 kHz, whistled melody): passes the gate,
`whistle_likeness=0.996`, median f0 1320 Hz (E6), **21 notes** after artifact
rejection. The recovered sequence has clear ABAB structure, which is the
cheapest evidence that segmentation is musically coherent rather than noisy:

```
G#6 F#6 E6 | E6 D#6 F6 G#6 | G#6 | G#6 D6 D6 | G#6 F6 E6 | G#6 F6 E6 | E6 D#6 F6 G#6
```

**Codec robustness.** The same recording transcoded to AAC 96k, opus 32k,
webm/opus 64k, mp3 128k (all stereo 44.1/48 kHz) and 16 kHz mono PCM yields
**21 notes in every case**, median f0 within 0.3 Hz. Stereo downmix and
resampling are handled by ffmpeg. iPhone Voice Memos, WhatsApp notes and browser
MediaRecorder output are all covered.

## Measured limits

Numbers below come from synthetic known-answer signals (`synth.py`,
`tests/test_synthetic.py`), not from real recordings yet. Reproduce any of them
by sweeping the CLI flags — every `Params` field is exposed.

**Repeated same-pitch notes need a real break of ≈60 ms.** Two consecutive
notes at the same pitch, whistled legato, are acoustically *one note* — there is
no boundary to find. The only cue is the whistler actually breaking the tone.
Measured threshold with the default 46 ms analysis window:

| gap between repeated notes | result |
|---|---|
| ≤ 50 ms | merged into one note |
| ≥ 60 ms | split correctly |

This is ambiguity in the signal, not a bug.

**In practice this matters less than expected.** On `teo.ogg` the pipeline
recovers **4 places where a note repeats** — `E6 E6`, `G#6 G#6 G#6`, `D6 D6`,
`E6 E6` (5 adjacent equal pairs, since one is a triple) — purely from the
unvoiced breaks. This whistler re-articulates with audible gaps, and gaps are
exactly what the segmenter keys on.

Those splits were checked rather than assumed, because the alternative reading
is that the segmenter is chopping *sustained* notes at mid-note breaths — which
would invert the conclusion. All 5 boundaries drop **32–41 dB and land within
3 dB of the clip noise floor**, i.e. complete silences of 175–629 ms with both
sides at full level. A breath taken while sustaining a whistle sags 10–20 dB,
not 40 dB to the floor. These are deliberate separations, so repeated-note
detection is genuinely working; only *truly legato* repeats are lost.

Still worth confirming against the actual tune — there is no ground-truth
annotation for `teo.ogg` yet.

### Why there is no amplitude-dip detector

The obvious next step is to split on a level dip inside a stable-pitch region —
the whistler re-articulating without fully breaking the tone. Measured on
`teo.ogg`, this is not worth doing:

- Of the 7 notes long enough to hide a repeat, **only 1 had any internal level
  dip ≥3 dB.** That one was 3.7 dB over a 100 ms width with **zero purity drop**
  and a 7-cent pitch notch — indistinguishable from slow tremolo. A genuine
  tongue/breath re-articulation should show a purity drop from turbulence.
- Meanwhile **vibrato-coupled amplitude modulation dominates**: in the short
  notes, 76–99% of level-modulation energy sits in the 4–9 Hz vibrato band. A
  dip detector sensitive enough to catch real re-articulations would false-split
  those notes every vibrato cycle.

So the cue barely exists and the confound is strong. Lowering `frame_size` to
resolve shorter breaks was also tested (256/512 vs 1024) and finds nothing more
on this recording — 21 notes becomes 22, still 5 repeats, so this whistler's
breaks are all comfortably above the 60 ms threshold.

**Verdict: keep the break-based mechanism, add nothing.** If legato repeats ever
turn out to matter, the right shape is an *advisory* list of low-confidence split
candidates that the product can accept or ignore — never a hard boundary, since
a false split corrupts the reveal curve permanently. Revisit only with a set of
labelled recordings from whistlers who actually slur repeats.

**`frame_size` trades gap resolution against nothing much, on clean signals:**

| frame_size | window | max f0 error | min resolvable gap |
|---|---|---|---|
| 256 | 12 ms | 1.2 cents | 40 ms |
| 512 | 23 ms | 0.8 cents | 45 ms |
| **1024 (default)** | **46 ms** | **0.6 cents** | **60 ms** |
| 2048 | 93 ms | 0.5 cents | 90 ms |

Pitch accuracy barely moves because a whistle is nearly a pure tone, so a
shorter window looks free — but only on clean audio. Short windows get much
noisier on a breathy whistle in a real room. **Decide this on real recordings**,
not on the table above.

**`ref_window_frames` must span several vibrato cycles.** Whistle vibrato runs
~5–7 Hz (140–200 ms period). The trailing median that estimates "the pitch we
are currently on" must be longer than that, or it tracks the vibrato instead of
the note centre, and a semitone step (100 cents) with ±25 cents vibrato stops
being detectable — only 50 cents of clearance. At 30 frames (150 ms) this
silently merged notes; ≥100 frames fixed it; default is 200 frames (1 s).
`test_semitone_step_survives_vibrato` guards this.

**Other known failure modes**, expected but not yet quantified on real audio:
glide/portamento-heavy styles (note count genuinely undefined), grace notes and
trills (over-segmentation), octave errors on weak or breathy whistles, another
voice in the room (harmonics reach into the whistle band; purity gating usually
saves it).

**Not addressed at all:** rhythm is not modelled, and no attempt is made to
identify the song.

## Two decisions worth keeping

**Don't cut audio into files.** `reveal_range()` returns a *time range of the
original recording* — play `first-note → end-of-note-N` with a short fade. It
starts at the first note minus `lead_s` (default 150 ms), not at 0.0:
recordings routinely carry a second of silence up front, which would otherwise
be most of an early reveal (on `teo.ogg`, 47% of the "first 2 notes" clip). No click
artifacts, no storage multiplication. `whistle slice` exports a wav only so the
boundaries can be checked by ear.

**Note boundaries are product-visible state.** The note count *is* the reveal
curve, so freeze each upload's segmentation at ingest and store
`pipeline_version` + `params_fingerprint` with it. When the algorithm improves,
**only new uploads get the new version** — never re-segment existing puzzles, or
the difficulty of puzzles people have already played changes silently. Storing
the f0 contour as well would allow re-segmenting without re-extracting f0.

## Performance

~10× realtime on an M-series CPU (3.75 s clip in 370 ms), single-threaded, no
GPU. Runtime deps are numpy + scipy, so the container is small.

Note for the intended stack: Supabase edge functions are Deno, so this cannot
run there. Shape is Storage upload → webhook → Python worker (Cloud Run, Fly, or
the NAS), async with a status field rather than blocking the upload request.

## Using this from a backend

### As a library

```python
from whistle import analyze, reveal_range

result = analyze("upload.webm")          # Params() defaults
payload = result.to_dict()               # the contract - store this

if not payload["quality"]["ok"]:
    raise Reject(payload["quality"]["reasons"])   # machine-readable

t0, t1 = reveal_range(result, n_notes=2)  # range to play for the first reveal
```

`analyze()` is pure and stateless: no globals, no temp files, no network. Safe
to call concurrently across processes. It shells out to `ffmpeg` once, so the
binary must be in the image.

Override any threshold immutably:

```python
from dataclasses import replace
from whistle import Params, analyze

result = analyze("upload.webm", replace(Params(), jump_cents=55.0))
```

### What to store, and why

| field | why it matters |
|---|---|
| `notes[]` (start_s, end_s, f0_hz, confidence) | the puzzle itself |
| `pipeline_version` | which algorithm produced these boundaries |
| `params_fingerprint` | which thresholds produced them |
| `metrics` | lets you re-calibrate the gate later without re-processing |

**Freeze the segmentation at ingest and never re-run it on an existing puzzle.**
The note count *is* the reveal curve, so re-segmenting changes the difficulty of
puzzles people have already played. When the pipeline improves, new uploads get
the new version; old rows keep theirs. That is what `pipeline_version` is for.

Worth also storing the f0 contour (`result.frames.f0` + `result.voiced`,
compressed — a few KB) if you ever want to re-segment *new* uploads without
re-decoding and re-tracking. Roughly 90% of the cost is in decode + tracking.

### Serving the reveal

Store offsets, not audio slices. `reveal_range(result, n)` returns a time range
of the **original** recording — serve it with an HTTP range request or a
client-side `currentTime`/`pause` pair plus a short fade, and keep exactly one
audio object per upload. Re-cutting into N files multiplies storage by the number
of reveal steps and introduces click artifacts at the boundaries.

`whistle slice` exists only so boundaries can be checked by ear during
calibration; it is not how the game should serve audio.

### Worker shape

Supabase edge functions are Deno, so this cannot run there. The shape that fits:

```
client upload -> Supabase Storage
              -> webhook / queue message
              -> Python worker container   <- this repo
              -> write notes + metrics + version back to Postgres
              -> mark the row ready
```

Run it **async with a status column** (`pending` / `ready` / `rejected`), not
inside the upload request. ~10x realtime single-threaded means a 15 s clip takes
~1.5 s, which is too slow to block an upload and far too slow if the queue backs
up.

Practical notes:

- **Container**: `python:3.12-slim` + `ffmpeg` + numpy/scipy. No torch, no
  numba, no model weights. Small image, cold-starts fine.
- **Concurrency**: one process per job. numpy releases the GIL for the FFT but
  the segmenter is Python-level; threads buy little.
- **Idempotency**: key the job on the storage object id. `analyze()` is
  deterministic for a given (file, params), so re-running is safe and produces
  byte-identical output — useful for retries.
- **Timeouts**: cap input duration (`q_max_duration_s`, default 40 s) and file
  size at the edge, before the worker. Reject early and cheaply.
- **Failure taxonomy**: `AudioError` (undecodable / empty / no ffmpeg) is a
  hard 4xx to the client; `quality.reasons` is a soft reject the client should
  explain ("we could not hear a clear whistle"). Everything else is a 5xx and
  should retry.
- **Observability**: log `metrics` and `quality.reasons` on every call. That is
  the calibration dataset for the `q_*` thresholds, which are still
  placeholders — see below.

### Anti-cheat placement

`whistle_likeness` catches someone uploading the real recording instead of
whistling, but it is a *pipeline* signal, not a policy. Keep the threshold
server-side and treat a near-miss as "flag for review" rather than a hard
reject — the score has only been validated against synthetic mixes and one real
whistle so far.

## Layout

```
whistle/
  config.py    Params - every threshold, hashable, stored with each result
  audio.py     ffmpeg decode, zero-phase band-pass, wav write, clip detection
  pitch.py     FFT-peak + parabolic-interpolation f0 tracker, purity
  segment.py   contour cleanup + plateau segmentation  <- the hard part
  quality.py   upload gate / anti-cheat
  pipeline.py  orchestration, Result.to_dict(), reveal_range()
  plot.py      debug PNG
  synth.py     known-answer whistle generator
  cli.py       analyze / batch / slice / synth
```

`samples/` is gitignored — drop recordings there and run `whistle batch`.
