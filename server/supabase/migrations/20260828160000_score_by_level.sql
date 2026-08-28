-- Score by ladder rung, not by note count.
--
-- The counters stored the number of notes a player solved on, which is not a
-- scale: the rungs are 3, 4, 5, 6, 7, all. On a 21-note tune the last rung is
-- worth 21, so one player who ran to the end pulls the mean past every rung that
-- exists, and the average lands on a note count nobody was ever offered — note 8
-- of a ladder that jumps 7 → 21.
--
-- Scoring the rung instead makes the gap between every level exactly one, the
-- last one included, so the mean is always interpretable as a level:
--
--   level 1 = 3 notes      level 4 = 6 notes
--   level 2 = 4 notes      level 5 = 7 notes
--   level 3 = 5 notes      level 6 = all of them
--
-- The client turns the average level back into a note count for display, so what
-- a player reads is still "most got it on 4" — but 4 is now guaranteed to be a
-- rung rather than an artefact of averaging.

-- ────────────────────────────────────────────────── how many rungs a tune has

-- Mirrors makeLadder() in client/src/game/levels.ts: the fixed rungs that fit
-- inside the tune, plus one for "all of them". Both must agree, or the server
-- will reject a level the client can legitimately reach — the reason it lives in
-- one function here rather than inline in the check below.
create or replace function public.level_count(n_notes int)
returns int
language sql
immutable
set search_path = ''
as $$
  select (
    select count(*) from unnest(array[3, 4, 5, 6, 7]) as t(x) where t.x < n_notes
  )::int + 1;
$$;

revoke all on function public.level_count(int) from public, anon, authenticated;

-- ────────────────────────────────────────────────── the column

alter table public.daily rename column solve_note_sum to solve_level_sum;

alter table public.daily
  drop constraint if exists daily_solve_note_sum_positive;

alter table public.daily
  add constraint daily_solve_level_sum_positive check (solve_level_sum >= 0);

-- Zero the counters. The stored value is a *sum* of note counts, and there is no
-- way back from a total to the individual results, so it cannot be converted —
-- and left as-is it would be read as a sum of levels and skew every average until
-- enough new plays drowned it out. solved_count and failed_count go with it: a
-- solve count kept beside a zeroed sum would report an average of zero, and a
-- failure count kept alone would report a solve rate of 0%.
--
-- Only a day of test plays is being discarded here. Doing this once, before the
-- numbers are shown to anyone, is cheaper than a permanently suspect average.
update public.daily
   set solved_count = 0, failed_count = 0, solve_level_sum = 0
 where solved_count <> 0 or failed_count <> 0 or solve_level_sum <> 0;

-- ────────────────────────────────────────────────── record_round(), by level

-- Renamed argument, so the old signature has to go: PostgREST resolves an RPC by
-- the argument names it is handed, and a client still sending `solved_at_note`
-- would otherwise keep writing note counts into a column that now means levels.
-- Dropping it makes that a loud 404 instead of quiet corruption.
drop function if exists public.record_round(date, uuid, boolean, int);

-- Called once when a round ends.
--
-- **This cannot be trusted.** The anon key is public and ships in the bundle, so
-- anyone can call this in a loop and move a day's par and solve rate wherever
-- they like. There is no account to rate-limit against, so the counters are
-- best-effort telemetry, not a scoreboard. What is enforced is only that a call
-- cannot be *nonsense*:
--
--   * the day must exist in `daily` and must not be in the future, so stats
--     cannot be seeded for a puzzle nobody has been shown;
--   * the song must be the one actually pinned to that day, so a result cannot
--     be filed against the wrong airing;
--   * a win's level must fall inside 1..level_count(n_notes), so the average
--     cannot be dragged off the ladder it is drawn on.
--
-- Replaying an old day counts, towards that day.
--
-- Europe/Paris, matching get_daily() — with 'utc' here, between 22:00 and 00:00
-- UTC the day the game is actively serving would look like the future and every
-- result for it would be silently dropped.
create or replace function public.record_round(
  d               date,
  song            uuid,
  won             boolean,
  solved_at_level int default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  notes  int;
  levels int;
begin
  if d is null or song is null or won is null then
    return false;
  end if;

  if d > (now() at time zone 'Europe/Paris')::date then
    return false;
  end if;

  select s.n_notes into notes
    from public.daily dd
    join public.songs s on s.id = dd.song_id
   where dd.puzzle_date = d
     and dd.song_id = song;

  if notes is null then
    return false;              -- no such day, or that song was not its puzzle
  end if;

  if won then
    levels := public.level_count(notes);
    if solved_at_level is null or solved_at_level < 1 or solved_at_level > levels then
      return false;
    end if;
    update public.daily
       set solved_count    = solved_count + 1,
           solve_level_sum = solve_level_sum + solved_at_level
     where puzzle_date = d;
  else
    update public.daily
       set failed_count = failed_count + 1
     where puzzle_date = d;
  end if;

  return true;
end $$;

revoke all on function public.record_round(date, uuid, boolean, int) from public, anon, authenticated;
grant execute on function public.record_round(date, uuid, boolean, int) to anon;

-- ────────────────────────────────────────────────── the payload, in levels

-- `avg_solve_note` becomes `avg_solve_level`. Renamed rather than quietly
-- redefined: the number means something different now, and a client reading the
-- old key would place the par marker at note 2 of 21 instead of level 2.
create or replace function public.puzzle_payload(sid uuid, d date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'date',          d,
    'id',            s.id,
    'title',         s.title,
    'from_label',    s.from_label,
    'category',      s.category,
    'accepted_norm', s.accepted_norm,
    'audio_path',    s.audio_path,
    'reveal',        s.reveal,
    'n_notes',       s.n_notes,
    'duration_s',    s.duration_s,

    -- Still a placeholder: difficulty needs a scale decided before it means
    -- anything, and every clip reading "Fair" is the current state.
    'difficulty',    'Fair',

    -- The average rung solvers reached, 1-based. Falls back to level 2 — the
    -- fourth note, where the design's mock put the mark — while nobody has
    -- solved it. Clamped into the ladder either way, because the client indexes
    -- its rungs with this.
    'avg_solve_level', case
      when coalesce(dd.solved_count, 0) > 0
        then greatest(1, least(public.level_count(s.n_notes),
               round(dd.solve_level_sum::numeric / dd.solved_count)::int))
      else least(public.level_count(s.n_notes), 2)
    end,

    -- Raw counts rather than a percentage: the client needs to tell "nobody has
    -- played this yet" apart from "nobody has solved it", and a single 0 cannot.
    'solved_count',  coalesce(dd.solved_count, 0),
    'failed_count',  coalesce(dd.failed_count, 0)
  )
  from public.songs s
  left join public.daily dd on dd.puzzle_date = d and dd.song_id = s.id
  where s.id = sid;
$$;

revoke all on function public.puzzle_payload(uuid, date) from public, anon, authenticated;
