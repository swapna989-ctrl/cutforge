-- Adds project_clips, the child table for multi-clip support: one project will eventually hold
-- an ordered list of source clips instead of the single `projects.source_key`. This migration is
-- purely additive — `projects.source_key` is untouched, nothing reads or writes this table yet,
-- and every existing project keeps working exactly as it does today via its own source_key.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.project_clips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- 0-based ordering within the project's timeline.
  position integer not null check (position >= 0),
  source_key text not null,
  file_name text not null,
  -- Nullable: filled in client-side once the browser reads the clip's real duration off its
  -- video element, same as everything else in this app avoids inventing data it doesn't have yet.
  duration numeric check (duration is null or duration >= 0),
  created_at timestamptz not null default now()
);

-- Also serves as the lookup index for "all clips in this project, in order" — project_id is the
-- leading column, so a plain `where project_id = ...` (with or without `order by position`) is
-- already served directly by this same index.
create unique index if not exists project_clips_project_id_position_idx
  on public.project_clips (project_id, position);

-- Row Level Security: same ownership model as `projects`, just via a join since a clip has no
-- user_id column of its own — a clip is owned by whoever owns the project it belongs to.
alter table public.project_clips enable row level security;

drop policy if exists "select_own_project_clips" on public.project_clips;
create policy "select_own_project_clips"
  on public.project_clips for select
  using (exists (
    select 1 from public.projects p
    where p.id = project_clips.project_id and p.user_id = auth.uid()
  ));

drop policy if exists "insert_own_project_clips" on public.project_clips;
create policy "insert_own_project_clips"
  on public.project_clips for insert
  with check (exists (
    select 1 from public.projects p
    where p.id = project_clips.project_id and p.user_id = auth.uid()
  ));

drop policy if exists "update_own_project_clips" on public.project_clips;
create policy "update_own_project_clips"
  on public.project_clips for update
  using (exists (
    select 1 from public.projects p
    where p.id = project_clips.project_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_clips.project_id and p.user_id = auth.uid()
  ));

drop policy if exists "delete_own_project_clips" on public.project_clips;
create policy "delete_own_project_clips"
  on public.project_clips for delete
  using (exists (
    select 1 from public.projects p
    where p.id = project_clips.project_id and p.user_id = auth.uid()
  ));

-- The worker runs as a trusted backend process (service role key, not a user's session), same
-- rationale and same policy name as the equivalent grant on `projects` in migration 0003 —
-- Postgres scopes policy names per-table, so reusing the name on a different table is fine.
drop policy if exists "service_role_full_access" on public.project_clips;
create policy "service_role_full_access"
  on public.project_clips for all
  to service_role
  using (true)
  with check (true);
