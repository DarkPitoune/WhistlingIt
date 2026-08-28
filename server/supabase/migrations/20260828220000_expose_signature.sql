-- Credit the whistler on the puzzle screens.
--
-- 20260828180000 deliberately kept the signature out of the payload, on the
-- grounds that a name beside an unguessed tune is a hint. That call is reversed:
-- the credit shows on both the unsolved and the solved screen. A whistler's name
-- is not the answer, and the booth is a contribution — the person who recorded it
-- should be visible while you are listening to it, not only after.
--
-- One consequence to keep in mind: the signature is free text and now reaches the
-- screen *before* the tune is guessed, so a signature like "Hedwig's Theme, by me"
-- would give the answer away. Nothing here can prevent that; it is a moderation
-- question, and worth knowing before the pool is open to strangers.
--
-- Null stays null rather than becoming a placeholder here. "Anonymous Whistler" is
-- wording, and wording belongs in the client next to every other string.

create or replace function public.puzzle_payload(sid uuid, d date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with computed as (
    select
      s.*,
      public.level_count(s.n_notes) as levels,
      case
        when coalesce(dd.solved_count, 0) > 0
          then greatest(1, least(public.level_count(s.n_notes),
                 round(dd.solve_level_sum::numeric / dd.solved_count)::int))
        else least(public.level_count(s.n_notes), 2)
      end as avg_level,
      coalesce(dd.solved_count, 0) as solved,
      coalesce(dd.failed_count, 0) as failed
    from public.songs s
    left join public.daily dd on dd.puzzle_date = d and dd.song_id = s.id
    where s.id = sid
  )
  select jsonb_build_object(
    'date',          d,
    'id',            c.id,
    'title',         c.title,
    'from_label',    c.from_label,
    'category',      c.category,
    'accepted_norm', c.accepted_norm,
    'audio_path',    c.audio_path,
    'reveal',        c.reveal,
    'n_notes',       c.n_notes,
    'duration_s',    c.duration_s,

    -- Who whistled it. Null for rows that predate the field, and for anyone who
    -- left it blank now that it is optional.
    'signature',     c.signature,

    -- Still a placeholder: difficulty needs a scale decided before it means
    -- anything, and every clip reading "Fair" is the current state.
    'difficulty',    'Fair',

    -- The average rung solvers reached, 1-based. What the current client reads.
    'avg_solve_level', c.avg_level,

    -- COMPATIBILITY, remove after the client deploys: the same average as a note
    -- count, which is what the shipped bundle indexes reveal.ends with. See
    -- 20260828200000 for why this is here.
    'avg_solve_note', case
      when c.avg_level >= c.levels then c.n_notes
      else c.avg_level + 2
    end,

    -- Raw counts rather than a percentage: the client needs to tell "nobody has
    -- played this yet" apart from "nobody has solved it", and a single 0 cannot.
    'solved_count',  c.solved,
    'failed_count',  c.failed
  )
  from computed c;
$$;

revoke all on function public.puzzle_payload(uuid, date) from public, anon, authenticated;
