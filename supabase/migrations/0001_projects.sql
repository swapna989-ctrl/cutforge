-- Real per-user project storage, replacing the hardcoded mock list.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  ratio text not null check (ratio in ('9:16', '16:9')),
  pipeline_status text not null default 'idle' check (pipeline_status in ('idle', 'ingesting', 'synthesizing', 'ready')),
  progress integer not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects (user_id);

-- Keep updated_at current on every write.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row
  execute function public.set_updated_at();

-- Row Level Security: each user can only ever see or touch their own rows.
-- This is the actual security boundary — the browser only ever holds the public
-- anon key, so without RLS any signed-in user could read/write anyone's projects.
alter table public.projects enable row level security;

drop policy if exists "select_own_projects" on public.projects;
create policy "select_own_projects"
  on public.projects for select
  using (auth.uid() = user_id);

drop policy if exists "insert_own_projects" on public.projects;
create policy "insert_own_projects"
  on public.projects for insert
  with check (auth.uid() = user_id);

drop policy if exists "update_own_projects" on public.projects;
create policy "update_own_projects"
  on public.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_projects" on public.projects;
create policy "delete_own_projects"
  on public.projects for delete
  using (auth.uid() = user_id);
