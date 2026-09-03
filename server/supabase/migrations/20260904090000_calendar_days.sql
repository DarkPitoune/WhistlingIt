-- Which days have a puzzle at all, for the calendar.
--
-- Until now the calendar coloured squares from localStorage alone, so a day the
-- game did not exist yet looked exactly like a day you simply hadn't played:
-- clickable, and leading to "Nothing that day". The grid needs to know which
-- squares are real, and it cannot find out one `get_daily_on` at a time — that
-- is 31 round trips a month to answer a question the server can answer in one.
--
-- Range-scoped rather than "give me every date": the client asks for the month
-- it is drawing. `first` rides along because the other half of the same question
-- is "how far back does this go" — the calendar clamps its ‹ button to the month
-- the game started, and asking for that separately would be a second round trip
-- for a single date that never changes.
--
-- Leaks nothing. Which days were pinned is already observable one date at a time
-- through `get_daily_on`, and unlike that function this returns no song at all —
-- just the dates. Future dates are excluded on the same reasoning as there: a day
-- becomes public when `get_daily()` reaches it, not before. In practice `daily`
-- cannot hold a future row, since `get_daily()` only ever inserts today; the
-- filter is there so that seeding ahead by hand stays private if it ever happens.
create or replace function public.calendar_days(d_from date, d_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bound as (
    -- Europe/Paris, matching get_daily() and get_daily_on(). On UTC these
    -- disagree for two hours every night, and today's square would go grey.
    select (now() at time zone 'Europe/Paris')::date as today
  )
  select jsonb_build_object(
    'first', (
      select min(puzzle_date) from public.daily, bound
       where puzzle_date <= bound.today
    ),
    'days', coalesce(
      (
        select jsonb_agg(puzzle_date order by puzzle_date)
          from public.daily, bound
         where puzzle_date <= bound.today
           and puzzle_date >= d_from
           and puzzle_date <= d_to
      ),
      '[]'::jsonb
    )
  );
$$;

-- As everywhere else here: `from public` alone leaves Supabase's default
-- by-name grants to anon and authenticated in place, so both are named.
revoke all on function public.calendar_days(date, date) from public, anon, authenticated;

grant execute on function public.calendar_days(date, date) to anon;
