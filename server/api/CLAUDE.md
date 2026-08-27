# CLAUDE.md — whistling-api + the whistle pipeline

Guidance for working in `server/api`. Read before changing `whistle/segment.py`
or any threshold in `whistle/config.py`.

Bare filenames below (`segment.py`, `config.py`, `synth.py`) live in `whistle/`.

## What this is

Two packages, one directory, one deployed image:

- **`whistle/`** — audio of someone whistling a melody in, **note-event
  timestamps** out. That is the entire scope of this package. Not in scope,
  deliberately: the UI, the game, song identification, rhythm modelling. It was
  a standalone repo (`whistle-pipeline`) until it was folded in here — keep it
  importable, and keep API concerns out of it.
- **`app/`** — the FastAPI ingest that runs it: transcode, analyze, gate, store.
  Only the booth ever calls it; the game reads Supabase directly and must never
  depend on this service being awake.

## Commands

```sh
uv sync                                        # venv + deps (Python 3.12)
uv run pytest -q                               # 62: the API's, plus 14 known-answer
uv run pytest -q tests/test_synthetic.py       # just the pipeline's known answers
uv run whistle analyze samples/teo.ogg --plot  # ALWAYS start here when debugging
uv run whistle batch samples/ --plot           # whole folder
uv run whistle analyze FILE --jump-cents 55    # every Params field is a CLI flag
```

Always `uv run` — never bare `python`. `ffmpeg` **and** `ffprobe` must be on
PATH: the pipeline decodes with one and the ingest reads durations with the
other.

## The one idea that explains the design

**Whistling has no attack transient.** No pluck, no consonant, no percussive
burst. Energy/spectral-flux onset detection — the standard approach, including
`librosa.onset_detect` — *cannot work here*. Boundaries are found as transitions
between plateaus of stable pitch. If you find yourself reaching for an onset
detector, stop.

Corollary: a whistle is nearly a pure sine, so the FFT-peak tracker in
`pitch.py` is competitive with pYIN/CREPE (0.6 cents worst case measured) and
keeps numba/torch out of the image. Runtime deps are numpy + scipy only. Keep
them that way; `matplotlib` and `pytest` are dev-group only.

## Where things live

| file | role |
|---|---|
| `whistle/config.py` | every threshold, frozen dataclass, hashable |
| `whistle/audio.py` | ffmpeg decode, zero-phase band-pass, wav write |
| `whistle/pitch.py` | f0 per frame + purity |
| `whistle/segment.py` | contour cleanup + plateau segmentation — **the hard part** |
| `whistle/quality.py` | upload gate / anti-cheat |
| `whistle/pipeline.py` | orchestration, `Result.to_dict()`, `reveal_range()` |
| `whistle/plot.py` | debug PNG |
| `whistle/synth.py` | known-answer signal generator |
| `app/main.py` | the one endpoint (`POST /uploads`) + `/healthz` |
| `app/ingest.py` | transcode → analyze → gate → store → insert, in that order |
| `app/transcode.py` | everything becomes mono AAC/m4a before analysis |
| `app/reveal.py` | the reveal ladder, computed once at ingest |
| `app/normalize.py` | answer normalization for guess matching |
| `app/supa.py` | Storage + table writes with the service key |
| `PIPELINE.md` | the pipeline's measured results and limits |

## Rules that came from getting this wrong

**Measure before changing a threshold.** Every number in `config.py` was set or
corrected by a sweep against known answers, and three plausible-sounding
diagnoses have already turned out to be wrong — `PIPELINE.md` records what was
actually measured. Write a throwaway
sweep script, print the table, then change the default. Do not tune on a single
recording.

**Test material must be in the whistle register (~800–2500 Hz, MIDI 80–98).**
The first version of `synth.py` wrote the melody at G4 (392 Hz), below the
tracker's 500 Hz floor, and every segmentation test failed for a reason that had
nothing to do with segmentation. `WHISTLE_REGISTER` exists to stop that.

**A test that passes must be able to fail.** `test_quiet_impure_fragment_is_dropped`
was initially vacuous — the injected fragment never became a note, so it proved
nothing about the gate it was named after. It now asserts the fragment *does*
leak through with the gate disabled. Apply the same pattern to any new gate: show
the thing you are suppressing actually appears without the suppression.

**Pitch is measured on the raw contour; smoothing is decision-only.** The
segmenter smooths to reject vibrato, but `_measure()` takes the median of the
*unsmoothed* contour over the segment interior with `edge_trim_ms` cut from each
end. Never report a value derived from the smoothed contour.

**`ref_window_frames` must span several vibrato cycles.** Whistle vibrato is
5–7 Hz (140–200 ms). At 150 ms the pitch reference tracked the vibrato instead
of the note centre, and a semitone step with ±25 cents vibrato silently merged.
Default is 200 frames (1 s). `test_semitone_step_survives_vibrato` guards it.

**Do not add note names, key detection, or tuning-offset estimation.** The game
reveals audio ranges; it never needs to know a note was C♯. Dropping this is
what makes off-key whistlers a non-problem. `midi` in the JSON is a bare log
transform of `f0_hz` and must stay that way — no key decision anywhere.

**Timestamps must not shift.** The band-pass is zero-phase (`sosfiltfilt`) and
frames are centred via `Params.frame_time()`. Any new filtering stage must
preserve both.

## Debugging workflow

1. `uv run whistle analyze FILE --plot`, then look at `out/FILE.png`.
2. Top panel: is the contour clean, are boundaries where you'd hear them, are
   unvoiced regions (shaded) where you'd expect breaths?
3. Bottom panel: level and purity. Almost every real-audio failure is visible
   here — a thump setting the level reference, or purity sagging below 0.5.
4. Only then read code.

## Known calibration landmines

These will look like pipeline bugs on new recordings. All are `config.py`
thresholds still marked as placeholders.

- `level_db` is normalised to **the loudest frame in the clip**. A door slam or
  phone-handling thump sets that reference and can push every genuine whistle
  frame below `level_floor_db`, giving zero voiced frames and a
  `not_enough_voiced_audio` reject on good audio. Symptom: "0 notes on
  obviously fine audio."
- `voiced_ratio` is computed over the **whole file**. A 3 s whistle inside a
  15 s recording scores 0.2 and false-rejects against `q_min_voiced_ratio`
  (0.25). Real uploads carry long lead-ins and tails.
- All `q_*` thresholds have only been checked against one real recording plus
  synthetic signals. The gate always reports measured values next to the
  verdict — use them.

## Product-visible invariant

**Note boundaries are product state.** The note count *is* the reveal curve.
Freeze each upload's segmentation at ingest with `pipeline_version` and
`params_fingerprint`, and when the algorithm improves apply it to **new uploads
only**. Re-segmenting existing puzzles silently changes the difficulty of
puzzles people have already played. If you change anything in
`whistle/segment.py` or a non-`q_*` threshold, bump `PIPELINE_VERSION`.

Folding the pipeline into this repo changed no threshold and no line of
`segment.py`, so `0.1.0` still describes the same algorithm and existing
`params_fingerprint` values still match.
