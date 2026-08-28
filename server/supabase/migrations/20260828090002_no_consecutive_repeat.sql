-- Never open on the same whistle two days running.
--
-- Reported as "it's a new day and the whistle didn't change": 2026-08-27 and
-- 2026-08-28 both landed on Harry Potter out of a six-song pool.
--
-- Two things let that happen, and only the second is fixable in SQL.
--
-- 1. `times_used` is the picker's only memory of "this has been on screen".
--    A `daily` row written by hand does not bump it — and one had been — so a
--    song that had already had its day still looked unused and was drawn again.
--    Bookkeeping, not logic; corrected in data alongside this migration.
--
-- 2. Even with honest counters, `order by times_used, random()` never excluded
--    yesterday's song. Once the pool has cycled, every song ties at the same
--    count and the previous day is as likely as anything else. A daily game
--    repeating itself is the one outcome the ordering exists to prevent, so a
--    tie is exactly where it needed a tie-breaker and had none.
--
-- The fix sorts the previous day's song last rather than filtering it out, so a
-- one-song pool still returns that song instead of going empty — the ordering
-- degrades to today's behaviour instead of breaking. `coalesce(..., false)` is
-- load-bearing: `s.id = null` is null, not false, and nulls sort last in ASC,
-- which would push every candidate behind the tie-breaker on day one when there
-- is no previous row at all.
--
-- Only the pick changes. Memoization, the race handling and the payload are
-- untouched, so a day already pinned in `daily` still returns exactly what it
-- returned before.

create or replace function public.get_daily()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today    date := (now() at time zone 'Europe/Paris')::date;
  sid      uuid;
  inserted uuid;
  prev     uuid;
begin
  select song_id into sid from public.daily where puzzle_date = today;

  if sid is null then
    -- The most recent day already pinned. Null on day one, which coalesce()
    -- below turns into "no song is disfavoured".
    select d.song_id into prev
      from public.daily d
     where d.puzzle_date < today
     order by d.puzzle_date desc
     limit 1;

    -- Anything but yesterday first; then times_used, so the pool still cycles
    -- fully before it repeats; then random to break the remaining tie.
    select s.id into sid
      from public.songs s
     where not s.hidden
     order by coalesce(s.id = prev, false), s.times_used, random()
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
