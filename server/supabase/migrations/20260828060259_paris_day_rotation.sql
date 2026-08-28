-- Rotate the daily puzzle on Europe/Paris, not UTC.
--
-- Why: the audience is entirely in France, and the client's "Next whistle in"
-- countdown has always counted down to the *browser's* midnight
-- (client/src/screens/Reveal.tsx). The pick was pinned to UTC. In CEST that put
-- the two clocks two hours apart, so the countdown hit 00:00:00 at Paris
-- midnight while get_daily() went on serving the previous day's song until
-- 02:00 local — players reloaded on a finished timer and got the same whistle.
--
-- The countdown was the honest half. For a once-a-day game whose players are all
-- in one country, midnight *there* is the boundary they expect; a 02:00 rotation
-- is the actual defect. So the day moves rather than the timer.
--
-- 'Europe/Paris' is a tz-database name, not a fixed offset, so this follows
-- CET/CEST across both DST transitions on its own. Never replace it with
-- `interval '2 hours'`: that is correct today and wrong from late October.
--
-- Only the `today` initialiser changes; the body below is otherwise identical to
-- 20260827172348_init_songs_daily.sql. `search_path = ''` is kept — timezone
-- names resolve through the tz database, not through the schema search path.
--
-- Deploy note: on any day the Paris and UTC dates already agree (i.e. any time
-- between 00:00 and 22:00 UTC) this is a no-op for the row already memoized in
-- `daily`. Applying it between 22:00 and 00:00 UTC rotates that day two hours
-- early — one puzzle gets a short day. Prefer to ship it outside that window.

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
