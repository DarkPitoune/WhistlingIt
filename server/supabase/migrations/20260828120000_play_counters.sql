-- Play counters, so par stops being a placeholder.
--
-- Three columns per song rather than a row per play: the only questions asked of
-- this data are "what note do people solve on" and "what share solve it at all",
-- and both are answered by running totals. A plays table would carry a row per
-- device per airing for no extra answer, and would need its own retention story.
--
-- Counters live on `songs`, not on `daily`, because a tune can be aired more than
-- once (the pool cycles by `times_used`) and "percentage who found it" is a fact
-- about the tune, not about the day.
--
-- ── only puzzle_payload() is replaced ─────────────────────────────────────
-- get_daily() and get_daily_on() both delegate their payload to it as of
-- 20260828090000, so changing the one function reaches both entry points. That
-- deliberately keeps this migration away from the pick: the Europe/Paris day
-- boundary (20260828090001) and the no-consecutive-repeat tie-breaker
-- (20260828090002) live inside get_daily(), and replaying an older body here
-- would silently revert them.

alter table public.songs
  add column solved_count   int    not null default 0,
  add column failed_count   int    not null default 0,
  -- Sum of the note counts people solved on. Divided by solved_count this is par.
  -- bigint because it grows with plays, not with the pool.
  add column solve_note_sum bigint not null default 0;

alter table public.songs
  add constraint songs_solved_count_positive   check (solved_count >= 0),
  add constraint songs_failed_count_positive   check (failed_count >= 0),
  add constraint songs_solve_note_sum_positive check (solve_note_sum >= 0);

-- ────────────────────────────────────────────────── record_round()

-- Called once when a round ends. Fire and forget: the client has already saved
-- the result locally, and a lost counter is worth less than a blocked screen.
--
-- **This cannot be trusted.** The anon key is public and ships in the bundle, so
-- anyone can call this in a loop and move a tune's par and solve rate wherever
-- they like. There is no account to rate-limit against, so the counters are
-- best-effort telemetry, not a scoreboard. What is enforced is only that a call
-- cannot be *nonsense*:
--
--   * the song must exist, and must have actually been aired — some `daily` row
--     on or before today points at it. Without that, stats could be seeded for a
--     puzzle nobody has been shown, which would poison it before its first day.
--   * a win's note count must fall inside 1..n_notes, so par cannot be dragged
--     outside the ladder it is drawn on.
--
-- Any airing counts, including someone replaying an old day. That is deliberate:
-- it means a solve rate mixes people who met the tune cold with people who came
-- back to it, and the number is softer than it looks.
--
-- Europe/Paris, matching get_daily() — with 'utc' here, between 22:00 and 00:00
-- UTC the day the game is actively serving would not yet count as aired and
-- every result for it would be silently dropped.
--
-- Returns whether anything was written, so the client can log a rejection rather
-- than silently believing it counted.
create or replace function public.record_round(
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
  if song is null or won is null then
    return false;
  end if;

  select s.n_notes into notes
    from public.songs s
   where s.id = song
     and exists (
       select 1
         from public.daily d
        where d.song_id = s.id
          and d.puzzle_date <= (now() at time zone 'Europe/Paris')::date
     );

  if notes is null then
    return false;                        -- unknown song, or never aired
  end if;

  if won then
    if solved_at_note is null or solved_at_note < 1 or solved_at_note > notes then
      return false;
    end if;
    update public.songs
       set solved_count   = solved_count + 1,
           solve_note_sum = solve_note_sum + solved_at_note
     where id = song;
  else
    update public.songs
       set failed_count = failed_count + 1
     where id = song;
  end if;

  return true;
end $$;

-- `from public` alone would leave Supabase's default grants to anon and
-- authenticated in place — they are granted by name, not through PUBLIC.
revoke all on function public.record_round(uuid, boolean, int) from public, anon, authenticated;
grant execute on function public.record_round(uuid, boolean, int) to anon;

-- ────────────────────────────────────────────────── the payload, with real par

-- Same shape plus two counts, and avg_solve_note is now measured rather than
-- assumed. Body otherwise byte-for-byte what production runs.
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

    -- Measured once anyone has solved it. Falls back to the fourth note — the
    -- second rung of the 3-4-5-6-7-all ladder, where the design's mock put the
    -- mark — while solved_count is still zero. Clamped into the ladder because
    -- the bar indexes reveal.ends with it.
    'avg_solve_note', case
      when s.solved_count > 0
        then greatest(1, least(s.n_notes,
               round(s.solve_note_sum::numeric / s.solved_count)::int))
      else least(s.n_notes, 4)
    end,

    -- Raw counts rather than a percentage: the client needs to tell "nobody has
    -- played this yet" apart from "nobody has solved it", and a single 0 cannot.
    'solved_count',  s.solved_count,
    'failed_count',  s.failed_count
  )
  from public.songs s where s.id = sid;
$$;

-- create or replace preserves privileges, so the revoke from 20260828090000
-- still stands: anon must never reach this directly. It takes a song id, and
-- execute on it would be a way to read any row in songs, tomorrow's included.
revoke all on function public.puzzle_payload(uuid, date) from public, anon, authenticated;
