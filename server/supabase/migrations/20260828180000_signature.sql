-- Who whistled it.
--
-- Collected as a required field in the booth, so from here on every upload is
-- signed. Nullable in the column, because the rows already in the pool predate
-- the field and there is nobody to attribute them to — a NOT NULL would need an
-- invented default, which is worse than an honest absence.
--
-- Not in the payload. get_daily() returns the answers for the day's puzzle, and
-- adding the signature there would put a name next to a tune before it has been
-- guessed — a hint, and a small privacy decision nobody has made. When it is time
-- to credit whistlers on the reveal, that is one line in puzzle_payload().

alter table public.songs
  add column signature text;

alter table public.songs
  add constraint songs_signature_length check (signature is null or length(signature) <= 80);

comment on column public.songs.signature is
  'Whoever whistled it, as they typed it. Required by the booth, nullable for rows that predate the field. Not exposed by get_daily().';
