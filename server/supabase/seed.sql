-- Local development only. `supabase db reset` runs this; `db push` does not.
--
-- Two rows, so the pick, the memoization and the times_used bookkeeping can all
-- be exercised. The first is the client's own reference clip with its real note
-- boundaries, so `npm run dev` against a local stack is actually playable —
-- run ./scripts/seed-audio.sh after a reset to put the audio in the bucket.
--
-- accepted_norm is written the way the API would write it: already through
-- normalize(), so apostrophes are gone and nothing else is.

insert into public.songs (
  id, audio_path, title, from_label, category,
  accepted_answers, accepted_norm,
  notes, n_notes, pipeline_version, params_fingerprint, metrics, reveal, duration_s
) values
(
  '00000000-0000-4000-8000-000000000001',
  'dev/hedwig.wav',
  'Hedwig''s Theme',
  'Harry Potter · John Williams',
  'Film',
  array['Hedwig''s Theme', 'Harry Potter', 'Hedwig', 'Poudlard', 'HP'],
  array['hedwigs theme', 'harry potter', 'hedwig', 'poudlard', 'hp'],
  -- Shaped like the pipeline's output, with the reference clip's real boundaries.
  (select jsonb_agg(jsonb_build_object(
            'index', i,
            'start_s', s,
            'end_s', e,
            'duration_s', round((e - s)::numeric, 3),
            'f0_hz', 1500.0, 'midi', 90.0, 'confidence', 0.95, 'level_db', -2.0)
          order by i)
     from unnest(
       array[0,0.62,1.55,1.86,2.48,3.72,4.34,6.2,8.06,8.99,9.3,9.92,11.16,11.78],
       array[0.62,1.55,1.86,2.48,3.72,4.34,6.2,8.06,8.99,9.3,9.92,11.16,11.78,13.64]
     ) with ordinality as t(s, e, ord), lateral (select ord - 1) as o(i)),
  14,
  '0.1.0-devfixture',
  'devfixture01',
  '{"duration_s":13.89,"voiced_ratio":0.82,"whistle_likeness":0.99,"clip_ratio":0.0,"median_f0_hz":1500.0}'::jsonb,
  '{"lead_s":0.15,"t0":0.0,
    "starts":[0,0.62,1.55,1.86,2.48,3.72,4.34,6.2,8.06,8.99,9.3,9.92,11.16,11.78],
    "ends":[0.62,1.55,1.86,2.48,3.72,4.34,6.2,8.06,8.99,9.3,9.92,11.16,11.78,13.64]}'::jsonb,
  13.89
),
(
  '00000000-0000-4000-8000-000000000002',
  'dev/tetris.m4a',                    -- no audio behind this one; it exists so
  'Korobeiniki',                       -- the pick has something to rotate to
  'Tetris',
  'Game',
  array['Korobeiniki', 'Tetris'],
  array['korobeiniki', 'tetris'],
  '[{"index":0,"start_s":0.20,"end_s":0.70,"duration_s":0.50,"f0_hz":1318.5,"midi":88.00,"confidence":0.98,"level_db":-1.8},
    {"index":1,"start_s":0.75,"end_s":1.10,"duration_s":0.35,"f0_hz":987.8,"midi":83.00,"confidence":0.97,"level_db":-2.2},
    {"index":2,"start_s":1.15,"end_s":1.50,"duration_s":0.35,"f0_hz":1046.5,"midi":84.00,"confidence":0.96,"level_db":-2.1},
    {"index":3,"start_s":1.55,"end_s":2.10,"duration_s":0.55,"f0_hz":1174.7,"midi":86.00,"confidence":0.98,"level_db":-1.9}]'::jsonb,
  4,
  '0.1.0-devfixture',
  'devfixture01',
  '{"duration_s":2.60,"voiced_ratio":0.88,"whistle_likeness":0.98,"clip_ratio":0.0,"median_f0_hz":1110.0}'::jsonb,
  '{"lead_s":0.15,"t0":0.05,"starts":[0.20,0.75,1.15,1.55],"ends":[0.70,1.10,1.50,2.10]}'::jsonb,
  2.60
);

-- Pin the reference clip as today's puzzle, so a reset always lands on the one
-- with real audio behind it rather than on Korobeiniki half the time.
insert into public.daily (puzzle_date, song_id)
values ((now() at time zone 'utc')::date, '00000000-0000-4000-8000-000000000001');
update public.songs set times_used = 1
 where id = '00000000-0000-4000-8000-000000000001';
