-- Public bucket for the whistle recordings.
--
-- Public read: players get plain CDN URLs, no signed URLs and no gating. The
-- full audio ships to the client anyway (that decision is locked), so there is
-- nothing for a signed URL to protect.
--
-- Writes come from the ingest API with the service key, which bypasses RLS on
-- storage.objects — so no storage policies are needed either.
--
-- This lives in a migration, not in config.toml's [storage.buckets.*], because
-- that block is local-dev only and `db push` would not create the bucket
-- remotely.

insert into storage.buckets (id, name, public, file_size_limit)
values ('songs', 'songs', true, 10485760)   -- 10 MiB, mirrors the API's cap
on conflict (id) do update
  set public          = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- allowed_mime_types is deliberately left null: a service-key upload can arrive
-- as application/octet-stream and a tight list would silently 400 it. The API
-- transcodes everything to AAC/m4a before upload, so the format is already
-- uniform by the time bytes reach storage.
