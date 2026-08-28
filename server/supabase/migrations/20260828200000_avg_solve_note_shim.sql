-- Put `avg_solve_note` back alongside `avg_solve_level`, for the deployed client.
--
-- 20260828160000 renamed the field. That was right for the data — a note count is
-- not a scale — but it was pushed to production while the shipped bundle still
-- read the old key, and nothing deploys the client on a `supabase db push`.
--
-- The result was silent: `row.avg_solve_note` came back undefined, Math.round made
-- it NaN, `noteEnds[NaN - 1]` was undefined, and the daily's `parTs !== undefined`
-- guard simply omitted the crowd marker. No error, no broken layout — the mark
-- just stopped being there, on the live site, for everyone.
--
-- So the payload carries both keys until the new bundle is out. `avg_solve_note`
-- is the note count the old client expects, derived from the same average level,
-- so the two can never disagree.
--
-- **Delete this once the client is deployed.** It exists only to span the window
-- between a schema push and a Pages build, and a payload with two names for one
-- fact is exactly the sort of thing that outlives its reason.

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

    -- Still a placeholder: difficulty needs a scale decided before it means
    -- anything, and every clip reading "Fair" is the current state.
    'difficulty',    'Fair',

    -- The average rung solvers reached, 1-based. What the current client reads.
    'avg_solve_level', c.avg_level,

    -- COMPATIBILITY, remove after the client deploys: the same average as a note
    -- count, which is what the shipped bundle indexes reveal.ends with. The rungs
    -- are 3·4·5·6·7·all, so rung k is k+2 until the last one, which is the lot.
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
