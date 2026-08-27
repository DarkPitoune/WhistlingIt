-- WhistlingIt — song pool and the daily pick.
--
-- One global puzzle per UTC day. The pick is memoized on first read by
-- get_daily(), so there is no scheduled job to fail silently.
--
-- Security shape: neither table has any anon policy or grant. The entire
-- anonymous surface is get_daily(), which returns the normalized answers for
-- today's song only. A read policy on songs would let an anon key walk every
-- future puzzle's title, so there is none.
--
-- gen_random_uuid() is core Postgres since 13; no pgcrypto needed on pg17.

-- ─────────────────────────────────────────────────────────── songs

create table public.songs (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),

  -- storage object path inside the public `songs` bucket. Not a URL: the client
  -- already has the project ref in its Supabase config and builds the CDN URL
  -- there, so the ref is never baked into a migration.
  audio_path         text        not null,

  title              text        not null,
  from_label         text,                            -- "Harry Potter · John Williams"
  category           text,                            -- Film | Jingle | TV | Game | Pop | Classical

  -- Two forms of the same list. Raw is for display, normalized is the matching
  -- logic. Both are written at ingest by the API's normalize(), so the client
  -- only ever compares normalize(guess) against accepted_norm.
  accepted_answers   text[]      not null,
  accepted_norm      text[]      not null,

  -- Frozen pipeline output. Never re-segment an existing row: the note count IS
  -- the reveal curve, so re-running the pipeline would silently change the
  -- difficulty of puzzles people have already played.
  notes              jsonb       not null,             -- whistle-pipeline to_dict()["notes"]
  n_notes            int         not null,
  pipeline_version   text        not null,
  params_fingerprint text        not null,
  metrics            jsonb       not null,             -- lets the q_* gate be recalibrated later

  -- Precomputed reveal ladder: {lead_s, t0, starts[], ends[]}. The client plays
  -- t0 -> ends[level-1] and pauses; it does no DSP-adjacent arithmetic and so
  -- can never drift from the Python. Carrying starts here as well is what lets
  -- get_daily() never return the full `notes` array: the client places its tick
  -- marks from starts and needs none of the f0 / midi / confidence that notes
  -- also holds.
  reveal             jsonb       not null,

  -- Full duration of the served m4a, not the last note's end. The timeline
  -- shows the whole track with the locked tail hatched, so it needs the file
  -- length; reveal.ends[-1] is where the audio stops being musically useful.
  duration_s         real        not null,

  hidden             boolean     not null default false,
  times_used         int         not null default 0,

  constraint songs_answers_nonempty     check (cardinality(accepted_answers) > 0),
  constraint songs_norm_nonempty        check (cardinality(accepted_norm) > 0),
  constraint songs_n_notes_matches      check (n_notes = jsonb_array_length(notes)),
  constraint songs_n_notes_positive     check (n_notes > 0),
  constraint songs_duration_positive    check (duration_s > 0),
  constraint songs_times_used_positive  check (times_used >= 0)
);

-- The pick is `where not hidden order by times_used, random() limit 1`.
create index songs_pick_idx on public.songs (times_used) where not hidden;

-- ─────────────────────────────────────────────────────────── daily

create table public.daily (
  puzzle_date date primary key,
  song_id     uuid not null references public.songs(id)
);

create index daily_song_id_idx on public.daily (song_id);

-- ─────────────────────────────────────────────────── lock the tables down

alter table public.songs enable row level security;
alter table public.daily enable row level security;

-- No policies. Deliberately. RLS with zero policies denies every row to every
-- non-bypassing role; the service key used by the ingest API bypasses RLS.

-- RLS alone is not enough: Supabase's default privileges grant anon SELECT,
-- which keeps the tables visible as PostgREST endpoints (returning 200 with an
-- empty array rather than an error). Revoking the grant is what actually makes
-- "the entire anon surface is one function" true.
revoke all on table public.songs from anon, authenticated;
revoke all on table public.daily from anon, authenticated;

-- ─────────────────────────────────────────────────────────── get_daily()

-- Returns today's puzzle, picking and memoizing it if this is the day's first
-- read. Returns null when the pool is empty (day one).
--
-- The shape is the client's DailyClip contract (client/src/api/types.ts), keyed
-- in snake_case; client/src/api/live.ts is the only thing that renames them.
--
-- The date is pinned to UTC in SQL rather than left to the session's TimeZone,
-- because the client keys its localStorage streak on the UTC date and the two
-- must agree structurally.
create or replace function public.get_daily()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today    date := (now() at time zone 'utc')::date;
  sid      uuid;
  inserted uuid;
begin
  select song_id into sid from public.daily where puzzle_date = today;

  if sid is null then
    -- times_used first, then random: the pool cycles fully before it repeats,
    -- and keeps working once every song has been used.
    select s.id into sid
      from public.songs s
     where not s.hidden
     order by s.times_used, random()
     limit 1;

    if sid is null then
      return null;                       -- empty pool
    end if;

    insert into public.daily (puzzle_date, song_id) values (today, sid)
      on conflict (puzzle_date) do nothing
      returning song_id into inserted;

    -- Only the winner of a concurrent race counts the play.
    if inserted is not null then
      update public.songs set times_used = times_used + 1 where id = inserted;
    end if;

    -- Re-read: on a lost race, the winner's pick is the one that stands.
    select song_id into sid from public.daily where puzzle_date = today;
  end if;

  return (
    select jsonb_build_object(
      'date',          today,
      'id',            s.id,
      'title',         s.title,
      'from_label',    s.from_label,
      'category',      s.category,
      -- Answers ship to the client on purpose: the full audio ships too and
      -- there is no leaderboard, so devtools cheating only costs the cheater.
      'accepted_norm', s.accepted_norm,
      'audio_path',    s.audio_path,
      'reveal',        s.reveal,
      'n_notes',       s.n_notes,
      'duration_s',    s.duration_s,

      -- Placeholders. The client's contract requires both fields and renders
      -- them (the bar's par tick, and "most got it on N" on the reveal card),
      -- but computing them for real needs a write per play, which is deferred.
      -- They live here rather than in the client adapter so that when the play
      -- counters land there is exactly one place to change.
      'difficulty',    'Fair',
      -- The fourth note: the second rung of the 3-4-5-6-7-all ladder, which is
      -- where the design's mock put the par mark. Half the clip would sit on the
      -- last rung before "all" and read as brutal.
      'avg_solve_note', least(s.n_notes, 4)
    )
    from public.songs s where s.id = sid
  );
end $$;

revoke all on function public.get_daily() from public;
grant execute on function public.get_daily() to anon;
