-- One-off repair for the day that repeated.
--
-- 2026-08-27 and 2026-08-28 were both pinned to Harry Potter. 20260828090002
-- stops it happening again, but it cannot unpick a day already memoized in
-- `daily` — that row is what the game serves, and it is still the repeat.
--
-- Two statements, in this order.
--
-- 1. Drop today's pin, but *only* if it repeats the previous pinned day. Written
--    as a condition rather than a bare delete so this is safe to replay and
--    cannot quietly discard a legitimate day: on a database where today is not
--    a repeat, and on a fresh local reset where `daily` is still empty at
--    migration time, it matches nothing. The next read re-picks under the new
--    ordering, which sorts the previous day's song last.
--
-- 2. Reconcile `times_used` to the history it is supposed to summarise. It is
--    the picker's whole memory of "this has been on screen" and is bumped only
--    by the insert inside get_daily(), so the `daily` row that had been
--    repointed by hand left it wrong in both directions: Harry Potter held two
--    days and counted one, while `pirouette cacahuette` counted a day it was
--    overwritten out of and never actually shown. Deriving the counter from
--    `daily` makes it true by construction instead of by bookkeeping, and gives
--    the song that lost its turn its turn back.
--
-- Deliberately not a trigger or a generated column: the count is only correct
-- because the insert and the increment happen together inside get_daily(), and
-- that stays the one writer. This just restates the invariant after a hand edit
-- broke it.

delete from public.daily d
 where d.puzzle_date = (now() at time zone 'Europe/Paris')::date
   and d.song_id is not distinct from (
     select p.song_id
       from public.daily p
      where p.puzzle_date < d.puzzle_date
      order by p.puzzle_date desc
      limit 1
   );

update public.songs s
   set times_used = (select count(*) from public.daily d where d.song_id = s.id)
 where s.times_used <> (select count(*) from public.daily d where d.song_id = s.id);
