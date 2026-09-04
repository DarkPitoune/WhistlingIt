-- Two games, one database: whistling.it/fr and whistling.it/en.
--
-- A song belongs to exactly one of them — decided by which booth it was recorded
-- in — and each side draws its own daily from its own pool. They share the audio
-- bucket, the pipeline, the counters and every line of SQL below; the only thing
-- that forks is which rows a query is allowed to see.
--
-- ── everything that exists today is French ──────────────────────────────────
-- The site has been French-facing since day one and every player on it is on
-- that pool, so the backfill is `'fr'` throughout and the English pool starts
-- empty. `get_daily('en')` returning null on day one is not a failure state: it
-- is the existing empty-pool path, which the client already renders as "no
-- whistle today" over an open booth. Seeding it is a booth job, not a migration.
--
-- ── why every new parameter has a default ───────────────────────────────────
-- The bundle on Pages right now calls these functions with no `l` at all, and it
-- keeps running for as long as a tab stays open — through this migration and
-- past the deploy that follows it. A defaulted parameter means those calls keep
-- resolving, and resolve to French, which is exactly where those players belong.
-- Without it there is a window where every open tab 404s on its next RPC.
--
-- PostgREST picks an overload by the argument *names* it is handed, so a bare
-- `get_daily()` sitting beside `get_daily(l text default 'fr')` would be
-- ambiguous rather than convenient. The old signatures are dropped and replaced
-- rather than added to.

-- ─────────────────────────────────────────────────────── songs.lang

-- `default 'fr'` outlives the backfill on purpose. It is a compatibility floor
-- for an ingest container that has not been redeployed yet: French is the right
-- guess for an unlabelled upload — it is where every existing song and every
-- existing player already is — so a stale API writes a row in the wrong pool
-- rather than failing the whistler's upload outright. The API sends the field
-- explicitly from this commit on; the default should never be the path taken.
alter table public.songs
  add column if not exists lang text not null default 'fr';

alter table public.songs
  drop constraint if exists songs_lang_known;
alter table public.songs
  add constraint songs_lang_known check (lang in ('fr', 'en'));

-- The pick is `where not hidden and lang = l order by times_used, random()`, so
-- the partial index has to lead with the column that now splits the pool in two.
drop index if exists public.songs_pick_idx;
create index songs_pick_idx on public.songs (lang, times_used) where not hidden;

-- ─────────────────────────────────────────────────────── daily.lang

-- Two puzzles per day now — one per pool — so the date alone stops identifying a
-- row. Existing rows are French by the same reasoning as above.
alter table public.daily
  add column if not exists lang text not null default 'fr';

alter table public.daily
  drop constraint if exists daily_lang_known;
alter table public.daily
  add constraint daily_lang_known check (lang in ('fr', 'en'));

alter table public.daily drop constraint daily_pkey;
alter table public.daily add primary key (puzzle_date, lang);

-- A song can only ever be drawn by its own side, so this is belt-and-braces
-- against a hand-written row pinning an English tune to the French calendar.
-- Enforced with a trigger rather than a check: a check constraint cannot read
-- another table.
create or replace function public.daily_lang_matches_song()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  song_lang text;
begin
  select s.lang into song_lang from public.songs s where s.id = new.song_id;
  if song_lang is distinct from new.lang then
    raise exception 'daily.lang (%) does not match songs.lang (%) for song %',
      new.lang, song_lang, new.song_id;
  end if;
  return new;
end $$;

drop trigger if exists daily_lang_matches_song on public.daily;
create trigger daily_lang_matches_song
  before insert or update of song_id, lang on public.daily
  for each row execute function public.daily_lang_matches_song();

-- ─────────────────────────────────────────────────────── the language argument

-- One place that decides what a language argument means, so the four entry
-- points below cannot drift on it. Null and absent both mean French, which is
-- what keeps the currently-deployed bundle working. Anything else is null —
-- callers treat that as "no puzzle", which is the safe read of a typo: better an
-- empty day than silently serving the other pool's tune.
create or replace function public.known_lang(l text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(l, 'fr'))
           when 'fr' then 'fr'
           when 'en' then 'en'
           else null
         end;
$$;

revoke all on function public.known_lang(text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────── get_daily(lang)

drop function if exists public.get_daily();

-- Today's puzzle for one side, picked and memoized on the day's first read.
--
-- Body is the no-consecutive-repeat pick from 20260828090002, with the side
-- added to all three of the places it has to appear: the pool it draws from,
-- the previous day it declines to repeat, and the row it writes. Missing any one
-- of them crosses the pools — the last two quietly, which is why they are called
-- out rather than left to the reader.
--
-- The local is `side`, not `lang`, and that is not cosmetic: a plpgsql variable
-- sharing a name with a column of a table in the same query is a live hazard,
-- and the obvious escape — qualifying it as `get_daily.lang` — is not accepted
-- here at all. A name the schema does not use needs no qualification to be
-- unambiguous, so `side` is the fix rather than the workaround.
create or replace function public.get_daily(l text default 'fr')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  side     text := public.known_lang(l);
  today    date := (now() at time zone 'Europe/Paris')::date;
  sid      uuid;
  inserted uuid;
  prev     uuid;
begin
  if side is null then
    return null;
  end if;

  select song_id into sid
    from public.daily
   where puzzle_date = today and lang = side;

  if sid is null then
    -- The most recent day already pinned *on this side*. Null before that side
    -- has ever run, which coalesce() below reads as "nothing is disfavoured".
    select d.song_id into prev
      from public.daily d
     where d.puzzle_date < today and d.lang = side
     order by d.puzzle_date desc
     limit 1;

    -- Anything but yesterday first; then times_used, so the pool cycles fully
    -- before it repeats; then random to break the remaining tie.
    select s.id into sid
      from public.songs s
     where not s.hidden and s.lang = side
     order by coalesce(s.id = prev, false), s.times_used, random()
     limit 1;

    if sid is null then
      return null;                       -- empty pool: day one on this side
    end if;

    insert into public.daily (puzzle_date, lang, song_id)
    values (today, side, sid)
      on conflict (puzzle_date, lang) do nothing
      returning song_id into inserted;

    -- Only the winner of a concurrent race counts the play.
    if inserted is not null then
      update public.songs set times_used = times_used + 1 where id = inserted;
    end if;

    -- Re-read: on a lost race, the winner's pick is the one that stands.
    select song_id into sid
      from public.daily
     where puzzle_date = today and lang = side;
  end if;

  return public.puzzle_payload(sid, today);
end $$;

revoke all on function public.get_daily(text) from public, anon, authenticated;
grant execute on function public.get_daily(text) to anon;

-- ─────────────────────────────────────────────────────── get_daily_on(d, lang)

drop function if exists public.get_daily_on(date);

create or replace function public.get_daily_on(d date, l text default 'fr')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  side text := public.known_lang(l);   -- named as in get_daily; see the note there
  sid  uuid;
begin
  if d is null or side is null then
    return null;
  end if;

  -- Europe/Paris, matching get_daily(): on UTC, between 22:00 and midnight the
  -- archive would refuse the very date the daily is serving.
  if d > (now() at time zone 'Europe/Paris')::date then
    return null;
  end if;

  select song_id into sid
    from public.daily
   where puzzle_date = d and lang = side;

  if sid is null then
    return null;
  end if;

  return public.puzzle_payload(sid, d);
end $$;

revoke all on function public.get_daily_on(date, text) from public, anon, authenticated;
grant execute on function public.get_daily_on(date, text) to anon;

-- ─────────────────────────────────────────────────── calendar_days(from, to, lang)

drop function if exists public.calendar_days(date, date);

-- Which days in a range this side ran, and the first day it ever ran. `first` is
-- per-language on purpose: it is what stops the calendar paging back past the
-- beginning, and the English side began later than the French one.
create or replace function public.calendar_days(d_from date, d_to date, l text default 'fr')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with args as (
    select public.known_lang(l) as lang,
           (now() at time zone 'Europe/Paris')::date as today
  )
  select jsonb_build_object(
    'first', (
      select min(puzzle_date) from public.daily, args
       where puzzle_date <= args.today
         and public.daily.lang = args.lang
    ),
    'days', coalesce(
      (
        select jsonb_agg(puzzle_date order by puzzle_date)
          from public.daily, args
         where puzzle_date <= args.today
           and puzzle_date >= d_from
           and puzzle_date <= d_to
           and public.daily.lang = args.lang
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.calendar_days(date, date, text) from public, anon, authenticated;
grant execute on function public.calendar_days(date, date, text) to anon;

-- ─────────────────────────────────────────────────── record_round(), scoped

-- No new parameter, and that is the point: the song already determines the side.
-- Taking a language from the caller would let a client file a French result
-- against the English row for the same date, and there is nothing to check it
-- against — whereas `daily.song_id` is already verified here.
--
-- The bug this closes is in the UPDATE, not the SELECT. `where puzzle_date = d`
-- used to name one row and now names two, so every counted round would have
-- landed on both sides' totals for that date.
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
  side   text;
begin
  if d is null or song is null or won is null then
    return false;
  end if;

  if d > (now() at time zone 'Europe/Paris')::date then
    return false;
  end if;

  select s.n_notes, dd.lang into notes, side
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
     where puzzle_date = d and lang = side;
  else
    update public.daily
       set failed_count = failed_count + 1
     where puzzle_date = d and lang = side;
  end if;

  return true;
end $$;

revoke all on function public.record_round(date, uuid, boolean, int) from public, anon, authenticated;
grant execute on function public.record_round(date, uuid, boolean, int) to anon;
