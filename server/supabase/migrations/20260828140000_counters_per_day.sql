-- Move the play counters from `songs` to `daily`: per airing, not per tune.
--
-- 20260828120000 put them on `songs`, which blends every airing of a tune into
-- one figure. The pool cycles by `times_used` and 20260828090002 only pushes
-- *yesterday* to the back, so a song genuinely can come round again — and when it
-- does, "62% found it" would be an average over two audiences, one of which had
-- already been told the answer. Keyed on the day, each airing reports itself.
--
-- `daily` is the right home for another reason: puzzle_date is its primary key,
-- so a play can only ever be attributed to a day that was actually pinned. On
-- `songs` there was nothing tying a count to an airing at all.
--
-- Consequence worth naming: par is now per-day too, so a re-aired tune starts
-- again from the fallback rather than inheriting the note average it earned last
-- time. That is the same trade — a fresh audience measured on its own.

-- ────────────────────────────────────────────────── the columns

alter table public.daily
  add column solved_count   int    not null default 0,
  add column failed_count   int    not null default 0,
  -- Sum of the note counts people solved on. Divided by solved_count this is par.
  add column solve_note_sum bigint not null default 0;

alter table public.daily
  add constraint daily_solved_count_positive   check (solved_count >= 0),
  add constraint daily_failed_count_positive   check (failed_count >= 0),
  add constraint daily_solve_note_sum_positive check (solve_note_sum >= 0);

-- Carry over what `songs` already collected. A song-level total cannot be split
-- across airings after the fact, so it is credited to that song's most recent
-- pinned day — which is where it came from in practice, the counters having
-- existed for less than a day. Rows with nothing to move are untouched.
update public.daily d
   set solved_count   = s.solved_count,
       failed_count   = s.failed_count,
       solve_note_sum = s.solve_note_sum
  from public.songs s
 where s.id = d.song_id
   and (s.solved_count > 0 or s.failed_count > 0)
   and d.puzzle_date = (
     select max(p.puzzle_date) from public.daily p where p.song_id = s.id
   );

alter table public.songs
  drop constraint if exists songs_solved_count_positive,
  drop constraint if exists songs_failed_count_positive,
  drop constraint if exists songs_solve_note_sum_positive;

alter table public.songs
  drop column if exists solved_count,
  drop column if exists failed_count,
  drop column if exists solve_note_sum;

-- ────────────────────────────────────────────────── record_round(), by day

-- The old signature took only a song and inferred nothing about when it was
-- played. Dropped rather than left beside the new one: PostgREST resolves an RPC
-- by the argument names it is given, so leaving both would let a stale client
-- keep writing to a function whose columns no longer exist.
drop function if exists public.record_round(uuid, boolean, int);

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
--   * a win's note count must fall inside 1..n_notes, so par cannot be dragged
--     outside the ladder it is drawn on.
--
-- Replaying an old day counts, towards that day. That is the point of keying on
-- the date: the result lands where it was earned rather than on whatever is
-- currently on the front page.
--
-- Europe/Paris, matching get_daily() — with 'utc' here, between 22:00 and 00:00
-- UTC the day the game is actively serving would look like the future and every
-- result for it would be silently dropped.
create or replace function public.record_round(
  d              date,
  song           uuid,
  won            boolean,
  solved_at_note int default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  notes int;
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
    if solved_at_note is null or solved_at_note < 1 or solved_at_note > notes then
      return false;
    end if;
    update public.daily
       set solved_count   = solved_count + 1,
           solve_note_sum = solve_note_sum + solved_at_note
     where puzzle_date = d;
  else
    update public.daily
       set failed_count = failed_count + 1
     where puzzle_date = d;
  end if;

  return true;
end $$;

-- `from public` alone would leave Supabase's default grants to anon and
-- authenticated in place — they are granted by name, not through PUBLIC.
revoke all on function public.record_round(date, uuid, boolean, int) from public, anon, authenticated;
grant execute on function public.record_round(date, uuid, boolean, int) to anon;

-- ────────────────────────────────────────────────── the payload, reading `daily`

-- Same fields as 20260828120000; the counts and par now come from the airing
-- rather than the tune. `d` was already a parameter, so the signature is
-- unchanged and both get_daily() and get_daily_on() pick this up untouched.
--
-- Left join, not inner: a caller could in principle ask for a song with no row
-- for that date, and the payload should still describe the tune rather than
-- vanish. coalesce keeps the counts at zero in that case.
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

    -- Measured once anyone has solved this airing. Falls back to the fourth note
    -- — the second rung of the 3-4-5-6-7-all ladder, where the design's mock put
    -- the mark — while solved_count is still zero. Clamped into the ladder
    -- because the bar indexes reveal.ends with it.
    'avg_solve_note', case
      when coalesce(dd.solved_count, 0) > 0
        then greatest(1, least(s.n_notes,
               round(dd.solve_note_sum::numeric / dd.solved_count)::int))
      else least(s.n_notes, 4)
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

-- create or replace preserves privileges, so the revoke from 20260828090000
-- still stands: anon must never reach this directly. It takes a song id, and
-- execute on it would be a way to read any row in songs, tomorrow's included.
revoke all on function public.puzzle_payload(uuid, date) from public, anon, authenticated;
