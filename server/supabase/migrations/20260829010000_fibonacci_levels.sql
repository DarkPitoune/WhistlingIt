-- The reveal curve becomes Fibonacci: 1, 2, 3, 5, 8, then the lot.
--
-- Two things follow for the server.
--
-- ── level_count() ────────────────────────────────────────────────────────────
-- It exists to validate a submitted level and to clamp the average, so it has to
-- agree with makeLadder() in client/src/game/levels.ts exactly. Under the new
-- curve that identity collapses to `least(6, n_notes)`:
--
--   n >= 6  the five Fibonacci rungs below n, padded from the top, plus "all" = 6
--   n <  6  there are only n distinct note counts to offer, so n rungs
--
-- Worth stating because it is no longer obvious from the sequence — 1,2,3,5,8 has
-- five entries, and a nine-note tune has six levels. The old body counted
-- `{3,4,5,6,7} < n_notes` and would now be wrong for every tune under nine notes.
--
-- ── the counters ─────────────────────────────────────────────────────────────
-- solve_level_sum holds level *indices*, and an index means a different amount of
-- tune than it did an hour ago: level 3 was five notes, now it is three. The sum
-- cannot be rescaled — it is a total, not a list — so a blended average would
-- mislabel both par and, now, the difficulty adjective derived from it.
--
-- Zeroed again, deliberately, and for the last time this should be needed: the
-- ladder is the thing these numbers are measured against, and it has now settled.

create or replace function public.level_count(n_notes int)
returns int
language sql
immutable
set search_path = ''
as $$
  select greatest(0, least(6, n_notes));
$$;

revoke all on function public.level_count(int) from public, anon, authenticated;

update public.daily
   set solved_count = 0, failed_count = 0, solve_level_sum = 0
 where solved_count <> 0 or failed_count <> 0 or solve_level_sum <> 0;

-- ────────────────────────────────────────────────── the payload

-- `difficulty` comes out. It was a literal 'Fair' on every row, and it is now
-- derived on the client from avg_solve_level — the same number wearing an
-- adjective, so serving it separately could only ever disagree with itself.
--
-- Safe to remove rather than deprecate: the previously deployed bundle read this
-- key through a whitelist with 'Fair' as the fallback, so a missing key renders
-- exactly what a present one did. Unlike the avg_solve_note rename, dropping it
-- changes nothing for an older client.
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

    -- Who whistled it. Null for rows that predate the field, and for anyone who
    -- left it blank — the client renders that as "Anonymous Whistler".
    'signature',     s.signature,

    -- The average rung solvers reached, 1-based. Measured once anyone has solved
    -- this airing; falls back to level 2 while solved_count is still zero.
    -- Clamped into the ladder because the client indexes its rungs with this.
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
