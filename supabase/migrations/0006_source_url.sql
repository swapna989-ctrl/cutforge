-- Adds projects.source_url — set when a project comes from a pasted YouTube/Twitch link instead
-- of an uploaded file. Purely additive: nullable, no default, every existing project (and every
-- upload-based project) simply has this column null and behaves exactly as it does today.
-- The worker downloads from source_url (see worker/src/ytdlp.ts) and then populates source_key
-- itself once the file is saved to R2 — after that point processing is identical to the
-- upload flow.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

alter table public.projects
  add column if not exists source_url text;
