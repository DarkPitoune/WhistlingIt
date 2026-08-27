# server

The backend, in two pieces that never depend on each other.

```
   players ──► GitHub Pages (client/)
                 │                    │
       getDaily()│                    │upload()  (booth only)
                 ▼                    ▼
        ┌──────────────────┐   ┌──────────────────────────┐
        │ Supabase         │◄──┤ Render: whistling-api    │
        │  postgres        │   │  FastAPI + ffmpeg        │
        │  storage (audio) │   │  whistle-pipeline as lib │
        └──────────────────┘   └──────────────────────────┘
             ▲ public CDN URLs
             └── audio bytes straight to the player
```

| Path | What it is |
| --- | --- |
| `supabase/migrations/` | The schema. Two files, both applied to the linked project. |
| `supabase/seed.sql` | Local dev only. Two songs, one with real audio behind it. |
| `scripts/seed-audio.sh` | Puts that audio in the local bucket. Re-run after every `db reset`. |
| `api/` | The ingest service. Docker, deployed to Render. |

## The one property worth protecting

**The game never talks to the API.** `getDaily()` goes Pages → Supabase RPC and
nothing else. The API is a free-tier container that spins down when idle, so a
cold start is tens of seconds — survivable for someone uploading a whistle,
fatal for someone opening the game. Because the daily path doesn't touch it, the
API can be asleep or broken all day and the game still works.

Do not "simplify" this by routing the daily through the API.

## Database

Two tables, and no anon access to either.

```
songs   the pool. audio_path, title, accepted_answers + accepted_norm,
        frozen pipeline output (notes, metrics, pipeline_version,
        params_fingerprint), the precomputed reveal ladder, hidden, times_used

daily   puzzle_date -> song_id. One row per UTC day, written on first read.
```

RLS is on with **zero policies**, and the anon/authenticated table grants are
revoked. RLS alone would not be enough: Supabase grants `anon` SELECT by
default, which keeps a table visible as a PostgREST endpoint. Verified:

```
GET  /rest/v1/songs   ->  401  permission denied for table songs
GET  /rest/v1/daily   ->  401  permission denied for table daily
POST /rest/v1/rpc/get_daily -> 200
```

That matters because a read policy on `songs` would let an anon key
`select title from songs` and walk every future puzzle. The entire anon surface
is one function.

### `get_daily()`

`security definer`, `search_path = ''`, granted to `anon` only. Returns today's
puzzle as jsonb, shaped like the client's `DailyClip` contract in snake_case.

Picks and memoizes on the day's first read — `insert … on conflict do nothing` —
so **there is no cron job** to fail silently. The pick is
`where not hidden order by times_used, random() limit 1`, so the pool cycles
fully before it repeats and keeps working once exhausted. Only the winner of a
concurrent race increments `times_used`.

The date is `(now() at time zone 'utc')::date`, not `current_date`. Pinning it in
SQL means the client's UTC streak key agrees with the server structurally rather
than by luck of the session's `TimeZone`:

```
set timezone='Pacific/Kiritimati';
select public.get_daily()->>'date', current_date;
--  2026-08-27  |  2026-08-28
```

Answers ship to the client deliberately. The full audio ships too and there is
no leaderboard, so devtools cheating only costs the cheater.

### Storage

Bucket `songs`, public read, 10 MiB per object. The API writes with the service
key (which bypasses RLS, so no storage policies are needed) and players get
plain CDN URLs — no signed URLs, no gating. Public objects come back with
`Access-Control-Allow-Origin: *`, which is what `decodeAudioData` needs.

The bucket is created by a **migration**, not by `config.toml` — that file's
`[storage.buckets.*]` block is local-dev only and `db push` would not create it
remotely.

## Local development

```sh
supabase start
supabase db reset             # migrations + seed
./scripts/seed-audio.sh       # audio into the bucket; storage.objects is reset too
supabase status               # the URL and anon key for client/.env.local
```

Then in `client/`, put those two values in `.env.local` and `npm run dev`. The
seed pins Hedwig's Theme as today's puzzle so a reset always lands on the row
with real audio behind it.

## Deploying the schema

```sh
supabase link --project-ref <ref>
supabase db push
supabase db diff --schema public     # want: "No schema changes found"
```

Currently linked to `ooknrfvatzjpoxedostm`; both migrations are applied and
`db diff` is clean.

## Ops

**Kill switch is two statements, not one.** The pick is memoized, so hiding a
song leaves today's `daily` row still pointing at it — confirmed by testing it:

```sql
update public.songs set hidden = true where id = '<uuid>';
delete from public.daily where puzzle_date = (now() at time zone 'utc')::date;
```

**Seeding the real pool.** `get_daily()` returns `null` on an empty pool and the
client renders that as "Nobody has whistled yet". Fill it through the booth, or
run the pipeline CLI locally and insert rows by hand.

**Backups.** Not needed. Streaks are `localStorage`; the only loss-bearing data
is the song pool, which is re-uploadable.

## Deviations from PLAN.md

| | |
| --- | --- |
| No `pgcrypto` | `gen_random_uuid()` is core Postgres since 13, and the extension's schema placement is a footgun. |
| `search_path = ''` + qualified names | Rather than `= public`. Same intent, and it's what Supabase's linter wants on `security definer`. |
| Explicit `revoke` on both tables | PLAN's "the entire anon surface is one function" is only true with it. |
| UTC pinned in SQL | PLAN listed "verify `current_date` is UTC" as a pre-commit check. Pinning removes the check. |
| `duration_s` is the file's duration | PLAN's comment called it redundant with `reveal.ends[-1]`. It isn't: the timeline hatches the locked tail, so it needs the file length. |
| `from_label` column | The booth design has a "From" field that PLAN's schema omitted. |
| `reveal` carries `starts` too | So `get_daily()` never returns the full `notes` array; the client needs the boundaries and none of the f0/midi/confidence. |
| `difficulty` + `avg_solve_note` are placeholders | The client contract requires both. Computing them needs a write per play, which is deferred — see below. |
| No leading-article rule in `normalize()` | See `api/README.md`. |

## Deferred, and where the slot is

- **Play counters** — `difficulty` and `avg_solve_note` are hardcoded to `'Fair'`
  and `least(n_notes, 4)` inside `get_daily()`, so there is one place to change.
  `submitRound()` in the client is a documented no-op.
- **Uneven note currency** — the slot is `build_reveal()` in
  `api/app/reveal.py`, at ingest. Not in the pipeline, not in the client.
- **Turnstile on the booth**, if it gets found and abused.
- **Where a reveal starts.** `reveal.t0` is computed at ingest and shipped as
  `DailyClip.startAt`, but nothing plays from it: `useClipPlayer(audioUrl,
  unlocked)` runs 0 → unlocked with no start offset. On a recording with a
  second of dead air, level 1 is mostly silence. Two ways out — thread `startAt`
  through the player, or trim the head during transcode so `t0` is always ~0.
  The second makes the client's play-from-0 model correct and needs no client
  change; it also mutates the stored artifact, so it is a product call.
