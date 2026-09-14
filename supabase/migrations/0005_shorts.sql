-- Adds shorts, the AI-generated clip table: one project's source video now produces several
-- candidate Shorts (each with its own render, hook, and caption) instead of a single output.
-- This is the schema half of replacing the old one-output-per-project model — projects.output_key
-- is no longer written by the worker going forward, but is left in place rather than dropped.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.shorts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- 0-based ordering, assigned in the AI Clip Planner's own startTime order.
  position integer not null check (position >= 0),
  -- Where this short falls in the (already dead-air-trimmed) source timeline, in seconds.
  source_start_seconds numeric not null check (source_start_seconds >= 0),
  source_end_seconds numeric not null check (source_end_seconds > source_start_seconds),
  -- AI Clip Planner output: a punchy on-screen opening line and a short social caption.
  hook text not null,
  caption text not null,
  -- Per-clip render status — one short failing to render shouldn't take the others down with it.
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'failed')),
  output_key text,
  error_message text,
  created_at timestamptz not null default now()
);

create unique index if not exists shorts_project_id_position_idx
  on public.shorts (project_id, position);

-- Row Level Security: same ownership model as project_clips — a short has no user_id column of
-- its own, so ownership is checked via a join to the project it belongs to.
alter table public.shorts enable row level security;

drop policy if exists "select_own_shorts" on public.shorts;
create policy "select_own_shorts"
  on public.shorts for select
  using (exists (
    select 1 from public.projects p
    where p.id = shorts.project_id and p.user_id = auth.uid()
  ));

drop policy if exists "insert_own_shorts" on public.shorts;
create policy "insert_own_shorts"
  on public.shorts for insert
  with check (exists (
    select 1 from public.projects p
    where p.id = shorts.project_id and p.user_id = auth.uid()
  ));

drop policy if exists "update_own_shorts" on public.shorts;
create policy "update_own_shorts"
  on public.shorts for update
  using (exists (
    select 1 from public.projects p
    where p.id = shorts.project_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = shorts.project_id and p.user_id = auth.uid()
  ));

drop policy if exists "delete_own_shorts" on public.shorts;
create policy "delete_own_shorts"
  on public.shorts for delete
  using (exists (
    select 1 from public.projects p
    where p.id = shorts.project_id and p.user_id = auth.uid()
  ));

-- The worker runs as a trusted backend process (service role key, not a user's session) — same
-- rationale and same policy name as the equivalent grants on projects/project_clips.
drop policy if exists "service_role_full_access" on public.shorts;
create policy "service_role_full_access"
  on public.shorts for all
  to service_role
  using (true)
  with check (true);
