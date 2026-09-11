-- Real per-user billing, replacing localStorage-based credits/plan.
-- The key difference from the projects table: RLS alone isn't enough here, because RLS only
-- restricts *which row* a user can touch, not *what values* they write to it — a user could
-- otherwise open devtools and set their own paid_credits to anything. So the client gets
-- SELECT only; every mutation goes through a SECURITY DEFINER function below that enforces the
-- actual business rules (never go negative, never spend while nothing's left, only valid plans).
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.billing (
  user_id uuid primary key references auth.users(id) on delete cascade,
  free_credits integer not null default 5 check (free_credits >= 0),
  paid_credits integer not null default 0 check (paid_credits >= 0),
  plan text not null default 'none' check (plan in ('none', 'weekly', 'monthly', 'yearly')),
  updated_at timestamptz not null default now()
);

alter table public.billing enable row level security;

drop policy if exists "select_own_billing" on public.billing;
create policy "select_own_billing"
  on public.billing for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies at all — the table has none, so the only way to change a
-- row is through the functions below (which run as their owner, bypassing RLS, but only ever
-- touch auth.uid()'s own row).

-- Auto-provision a billing row (5 free credits) the moment someone signs up.
create or replace function public.handle_new_user_billing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.billing (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_billing on auth.users;
create trigger on_auth_user_created_billing
  after insert on auth.users
  for each row
  execute function public.handle_new_user_billing();

-- Backfill: give any user who signed up before this migration a billing row too.
insert into public.billing (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.set_billing_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists billing_set_updated_at on public.billing;
create trigger billing_set_updated_at
  before update on public.billing
  for each row
  execute function public.set_billing_updated_at();

-- Spends one credit: an active plan spends nothing, then paid credits, then free credits.
-- Raises if there's genuinely nothing left, so the client gets an explicit error instead of a
-- silently-ignored no-op or (worse) a negative balance.
create or replace function public.consume_export_credit()
returns public.billing
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.billing;
begin
  select * into b from public.billing where user_id = auth.uid() for update;
  if b is null then
    raise exception 'No billing record for this user';
  end if;

  if b.plan <> 'none' then
    return b; -- unlimited while a plan is active, nothing to decrement
  elsif b.paid_credits > 0 then
    update public.billing set paid_credits = paid_credits - 1 where user_id = auth.uid() returning * into b;
  elsif b.free_credits > 0 then
    update public.billing set free_credits = free_credits - 1 where user_id = auth.uid() returning * into b;
  else
    raise exception 'No credits remaining';
  end if;

  return b;
end;
$$;

grant execute on function public.consume_export_credit() to authenticated;

-- Still a "demo" purchase (no real payment gateway wired up yet), but now server-enforced and
-- consistent across devices instead of living in one browser's localStorage.
create or replace function public.buy_credit_pack(amount integer)
returns public.billing
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.billing;
begin
  if amount is null or amount <= 0 then
    raise exception 'Invalid credit amount';
  end if;
  update public.billing set paid_credits = paid_credits + amount where user_id = auth.uid() returning * into b;
  if b is null then
    raise exception 'No billing record for this user';
  end if;
  return b;
end;
$$;

grant execute on function public.buy_credit_pack(integer) to authenticated;

create or replace function public.set_subscription_plan(new_plan text)
returns public.billing
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.billing;
begin
  if new_plan not in ('none', 'weekly', 'monthly', 'yearly') then
    raise exception 'Invalid plan: %', new_plan;
  end if;
  update public.billing set plan = new_plan where user_id = auth.uid() returning * into b;
  if b is null then
    raise exception 'No billing record for this user';
  end if;
  return b;
end;
$$;

grant execute on function public.set_subscription_plan(text) to authenticated;
