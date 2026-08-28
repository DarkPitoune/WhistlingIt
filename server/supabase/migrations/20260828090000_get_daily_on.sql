-- Past days, for the calendar.
--
-- `get_daily()` is pinned to today and takes no arguments, and both tables deny
-- anon outright, so until now the client had no way to read an earlier puzzle.
-- This adds `get_daily_on(date)` beside it.
--
-- The payload block moves into `puzzle_payload()` so the two entry points cannot
-- drift: a column added to one is added to both. That function is internal —
-- anon never gets execute on it, because it takes a song id and would otherwise
-- be a way to read any row in `songs`, including tomorrow's.

-- ────────────────────────────────────────────────── the shared payload

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

    -- Placeholders, as in get_daily(). See the note there: computing these for
    -- real needs a write per play, which is deferred.
    'difficulty',    'Fair',
    'avg_solve_note', least(s.n_notes, 4)
  )
  from public.songs s where s.id = sid;
$$;

-- `from public` alone is not enough. Supabase's default privileges grant EXECUTE
-- on new functions to anon and authenticated by name, and a revoke aimed at
-- PUBLIC leaves those explicit grants in place — verified by calling it as anon
-- and getting a row back. Since this takes a song id, that would have been a way
-- to read any song, tomorrow's included, straight past the one-function surface.
revoke all on function public.puzzle_payload(uuid, date) from public, anon, authenticated;

-- ────────────────────────────────────────────────── get_daily_on(date)

-- The puzzle for a past date, or null.
--
-- Deliberately narrower than get_daily():
--
--   * It never inserts. get_daily() picks and memoizes a song when the day has
--     no row yet; doing that here would let anyone mint puzzles for arbitrary
--     dates and burn through the pool's times_used ordering.
--   * It refuses future dates, so tomorrow's puzzle cannot be read early. A day
--     only becomes readable once get_daily() has pinned it.
--   * A date with no row returns null rather than an error — for the calendar
--     that is the ordinary case, not a failure.
--
-- `hidden` is not checked: hiding a song is a kill switch for *future* picks,
-- and a day already played should stay readable on the calendar. If a puzzle
-- ever needs pulling retroactively, delete its `daily` row.
create or replace function public.get_daily_on(d date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  if d is null or d > (now() at time zone 'utc')::date then
    return null;
  end if;

  select song_id into sid from public.daily where puzzle_date = d;
  if sid is null then
    return null;
  end if;

  return public.puzzle_payload(sid, d);
end $$;

revoke all on function public.get_daily_on(date) from public;

grant execute on function public.get_daily_on(date) to anon;

-- ────────────────────────────────────────────────── get_daily(), via the helper

-- Unchanged behaviour: pick-and-memoize, then return the same payload. Only the
-- final block differs, so that the shape lives in one place.
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

  return public.puzzle_payload(sid, today);
end $$;

revoke all on function public.get_daily() from public;

grant execute on function public.get_daily() to anon;
