-- Adds the columns the real processing worker needs: where the raw upload and finished
-- master live in R2, a human-readable stage message, and an error slot for failed jobs.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

alter table public.projects
  add column if not exists source_key text,
  add column if not exists output_key text,
  add column if not exists status_message text,
  add column if not exists error_message text,
  add column if not exists watermark boolean not null default false;

comment on column public.projects.watermark is
  'Captured from the user''s billing status at the moment this job was queued — the worker burns '
  'a watermark into the real output file when true. This is the actual enforcement point for the '
  'free tier; billing.isWatermarkFree alone is only a UI preview, not a guarantee about the file.';

-- Replace the old status check to add "queued" (uploaded, waiting for the worker) and
-- "failed" (the worker hit an error) to the existing idle/ingesting/synthesizing/ready set.
alter table public.projects drop constraint if exists projects_pipeline_status_check;
alter table public.projects add constraint projects_pipeline_status_check
  check (pipeline_status in ('idle', 'ingesting', 'queued', 'synthesizing', 'ready', 'failed'));

-- The worker runs as a trusted backend process (using the service role key, not a user's
-- session), so it needs to see and update every user's queued/in-progress row — RLS as
-- configured today only lets a user see their own. This policy adds that for the service
-- role specifically; ordinary users still only ever see their own rows via the existing
-- "select_own_projects" policy from migration 0001.
drop policy if exists "service_role_full_access" on public.projects;
create policy "service_role_full_access"
  on public.projects for all
  to service_role
  using (true)
  with check (true);
