-- Drop the `avg_solve_note` compatibility key.
--
-- 20260828200000 added it because a schema push had renamed the field out from
-- under the deployed bundle, which silently lost the crowd marker. That bundle is
-- gone: the build for e741537 reads `avg_solve_level` and no longer mentions
-- `avg_solve_note` at all, so the shim has no reader left.
--
-- Removed rather than left as harmless. Two names for one fact is the kind of
-- thing that stops being a stopgap and becomes the schema, and a later reader
-- has no way to tell which one is authoritative.
--
-- The lesson it encodes, for next time: `supabase db push` is instant and the
-- client ships on a commit, so a payload rename has to be additive first and
-- renamed second — never both at once.

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

    -- Still a placeholder: difficulty needs a scale decided before it means
    -- anything, and every clip reading "Fair" is the current state.
    'difficulty',    'Fair',

    -- The average rung solvers reached, 1-based. Measured once anyone has solved
    -- this airing; falls back to level 2 — the fourth note, where the design's
    -- mock put the mark — while solved_count is still zero. Clamped into the
    -- ladder because the client indexes its rungs with this.
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
