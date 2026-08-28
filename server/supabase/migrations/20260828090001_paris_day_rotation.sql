-- Rotate the daily puzzle on Europe/Paris, not UTC — both entry points.
--
-- Every player is in France, and the reveal countdown has always counted down
-- to the browser's midnight. The pick was pinned to UTC, so in CEST the two
-- clocks sat two hours apart: the timer hit 00:00:00 at Paris midnight while
-- get_daily() went on serving the previous day's song until 02:00 local.
-- Players reloaded on a finished timer and got the same whistle.
--
-- The countdown was the honest half. For a once-a-day game whose audience is
-- one country, midnight there is the boundary they expect, so the day moves
-- rather than the timer. The client half shipped in 9de5f3d.
--
-- 'Europe/Paris' is a tz-database name, not a fixed offset, so this follows
-- CET/CEST across both changeovers on its own. Never `interval '2 hours'`:
-- correct today, wrong from the last Sunday in October.
--
-- ── why this supersedes 20260828060259 ────────────────────────────────────
-- That migration was written against the schema in git, which by then had been
-- overtaken: 20260828090000 was applied straight to production and split the
-- payload out into puzzle_payload(), added the get_daily_on(date) archive
-- endpoint, and left get_daily() delegating. Replaying the older file would
-- have reinstated the inlined payload and undone that. It is deleted here and
-- this one is timestamped after 20260828090000 so the ordering is honest.
--
-- ── both functions, not just the daily ───────────────────────────────────
-- get_daily_on() guards against walking future puzzles with
-- `d > (now() at time zone 'utc')::date`. Moving only get_daily() would
-- recreate the very split this fixes one layer down: between 22:00 and 00:00
-- UTC the archive would refuse the date the daily is actively serving. The two
-- have to read the same clock.
--
-- Bodies below are otherwise byte-for-byte what production runs today; only the
-- zone changes. `search_path = ''` is kept — timezone names resolve through the
-- tz database, not the schema search path. Privileges are deliberately not
-- touched: `create or replace` preserves them, and the grants in production are
-- not this migration's business.

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
  if d is null or d > (now() at time zone 'Europe/Paris')::date then
    return null;
  end if;

  select song_id into sid from public.daily where puzzle_date = d;
  if sid is null then
    return null;
  end if;

  return public.puzzle_payload(sid, d);
end $$;
