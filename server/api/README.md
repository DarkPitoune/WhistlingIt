# whistling-api

The booth's ingest endpoint. Takes a recording, decides whether it is a whistle,
and if so puts it in the pool for a future day.

Nothing else lives here, on purpose: the player never talks to this service, so
it is free to be slow, cold or down. See `../README.md`.

## Endpoints

### `POST /uploads`

multipart: `audio`, `title`, repeated `accepted_answers`, optional `category`
and `from_label`. Returns `201 {"id", "n_notes"}`.

```
201  in the pool, for a future day — not for today
400  bad_request   the labels don't work (blank title, unknown category, …)
400  bad_audio     ffmpeg couldn't read it
413  too_large     over 10 MB
422  rejected      the quality gate said no, with machine-readable `reasons`
```

The 422's `reasons` come from the pipeline verbatim (`not_whistle_like`,
`too_few_notes`, `clipping`, …) and `client/src/api/live.ts` turns each one into
a sentence a whistler can act on. `metrics` rides along on every rejection
because the pipeline's `q_*` thresholds are still placeholders and these are the
calibration dataset.

Blocking, no queue, no pending status. The song joins the pool for a *future*
day so nothing needs it to be fast — and the uploader's wait is what buys them
the verdict on their whistle.

### `GET /healthz`

Render's health check, and what the booth hits to warm the instance before the
user starts recording.

## The step order in `ingest.py` is not negotiable

1. **Transcode first, then analyze the transcoded file.** Encoder priming shifts
   playback by 20–50 ms against `start_s`, and the pipeline's invariant is that
   timestamps don't shift. Analyse the exact artifact you will serve.
2. **Gate before uploading anything.** A rejected whistle leaves no bytes behind.
3. **Upload, then insert, and delete the object if the insert fails**, so there
   is never a row pointing at a missing file.

Everything becomes mono AAC 96k in an m4a container. iOS Safari has been
unreliable on Opus-in-WebM, and browsers hand over whatever `MediaRecorder` felt
like producing, so the transcode makes the served format uniform. Render's native
Python runtime has no ffmpeg, which is why this ships as a Docker image.

## `normalize()` — the function that exists in two languages

`app/normalize.py` and `normalise` in `client/src/game/match.ts` must agree
exactly. If they don't, an uploader typing `"Hedwig's Theme "` with a curly
apostrophe creates a puzzle **no correct guess can ever match** — the client
normalises one side of the comparison and not the other.

Both are tested against one file:

```sh
cd server/api  && .venv/bin/python -m pytest      # the Python half
cd client      && npm run check:normalize          # the JS half
```

`tests/normalize_fixtures.json` is the contract — 32 cases, and the Python is a
deliberate line-for-line transliteration of the JavaScript, with each step naming
its counterpart. Two places where the obvious Python is subtly a different
function are called out in the module docstring.

**PLAN.md's leading-article rule is deliberately not implemented.** The client
matches substrings in both directions, so a guess of "The Godfather" already
finds a stored "godfather" and vice versa. An exact mirror is worth more than a
rule only one side would know about.

## Running it

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python fastapi "uvicorn[standard]" \
   python-multipart supabase pytest httpx \
   "whistle-pipeline @ file:///path/to/whistle-pipeline"     # local, for now
.venv/bin/python -m pytest
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... .venv/bin/uvicorn app.main:app --reload
```

`ffmpeg` and `ffprobe` must be on PATH.

## Deploying

`render.yaml` is a blueprint: Docker runtime, `rootDir: server/api`, health check
on `/healthz`, free plan. Set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and
`ALLOWED_ORIGINS` in the dashboard — the service key exists there and nowhere
else, and never in a `VITE_` variable.

**The image cannot build yet.** `pyproject.toml` pins the pipeline by commit SHA:

```
whistle-pipeline @ git+https://github.com/DarkPitoune/whistle-pipeline@d9e3ec5c…
```

`../../../whistle-pipeline` has no git remote, so that URL 404s. Push it public
first. The pin is by SHA and not by branch on purpose: `pipeline_version` is
product state, and an unpinned dependency would silently change the note
boundaries new uploads get.

The distribution name is `whistle-pipeline` (import name `whistle`).
PLAN.md writes `whistle @ git+…`, which pip rejects as a metadata name mismatch.

## Deferred

`build_reveal()` in `app/reveal.py` is where the uneven-note-currency rule goes
if it ever lands — a level becoming "the next note *or* +1.5 s, whichever is
longer". At ingest, not in the pipeline's `segment.py` and not in the client.
