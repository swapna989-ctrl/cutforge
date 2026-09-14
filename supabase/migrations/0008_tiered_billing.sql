-- Replaces the old "plan = unlimited exports" model with real tiers (Starter/Creator/Agency),
-- each carrying a monthly video allowance instead of unlimited submissions — the old model had
-- no cap at all while a plan was active, which doesn't match what we can actually afford to
-- process per subscriber. Run this once in the Supabase dashboard: SQL Editor -> New query ->
-- paste -> Run. Requires the pg_cron extension (Database -> Extensions -> pg_cron) for the
-- monthly credit reset at the bottom of this file.

create table if not exists public.plan_tier_config (
  tier text primary key check (tier in ('starter', 'creator', 'agency')),
  monthly_credits integer not null check (monthly_credits > 0),
  -- 0 means "no rollover, reset to monthly_credits exactly"; otherwise the cap unused credits
  -- can accumulate to before the next month's allowance stops adding on top.
  rollover_cap integer not null check (rollover_cap >= 0)
);

insert into public.plan_tier_config (tier, monthly_credits, rollover_cap) values
  ('starter', 15, 0),
  ('creator', 45, 90),
  ('agency', 120, 240)
on conflict (tier) do update set monthly_credits = excluded.monthly_credits, rollover_cap = excluded.rollover_cap;

-- No RLS needed — this is read-only reference data, not per-user, and only referenced from
-- inside SECURITY DEFINER functions below, never queried directly by the client.

alter table public.billing add column if not exists plan_tier text not null default 'none'
  check (plan_tier in ('none', 'starter', 'creator', 'agency'));
alter table public.billing add column if not exists billing_cycle text not null default 'monthly'
  check (billing_cycle in ('monthly', 'yearly'));
alter table public.billing add column if not exists plan_credits integer not null default 0
  check (plan_credits >= 0);
alter table public.billing add column if not exists plan_renews_at timestamptz;

-- Drop the old unlimited-while-active plan concept — no real subscribers exist on it yet (this
-- launched as a demo checkout, before real payments), so there's nothing to migrate.
drop function if exists public.set_subscription_plan(text);
update public.billing set plan_tier = 'none', plan_credits = 0, plan_renews_at = null where plan <> 'none';
alter table public.billing drop column if exists plan;

create or replace function public.set_subscription_tier(new_tier text, new_cycle text default 'monthly')
returns public.billing
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.billing;
  cfg public.plan_tier_config;
begin
  if new_tier = 'none' then
    update public.billing
    set plan_tier = 'none', plan_credits = 0, plan_renews_at = null
    where user_id = auth.uid()
    returning * into b;
    if b is null then
      raise exception 'No billing record for this user';
    end if;
    return b;
  end if;

  if new_cycle not in ('monthly', 'yearly') then
    raise exception 'Invalid billing cycle: %', new_cycle;
  end if;

  select * into cfg from public.plan_tier_config where tier = new_tier;
  if cfg is null then
    raise exception 'Invalid plan tier: %', new_tier;
  end if;

  -- Switching (or re-subscribing to) a tier grants its full monthly allowance immediately and
  -- restarts the one-month renewal clock — the same "takes effect now" semantics the old demo
  -- checkout had, just with a real credit count behind it instead of "unlimited".
  update public.billing
  set plan_tier = new_tier, billing_cycle = new_cycle, plan_credits = cfg.monthly_credits, plan_renews_at = now() + interval '1 month'
  where user_id = auth.uid()
  returning * into b;
  if b is null then
    raise exception 'No billing record for this user';
  end if;
  return b;
end;
$$;

grant execute on function public.set_subscription_tier(text, text) to authenticated;

-- Spends one credit: plan credits first (if any left this cycle), then paid credits, then free
-- credits. Unlike the old "unlimited while a plan is active" rule, a subscriber who has used up
-- this month's allowance falls through to paid top-up credits exactly like a non-subscriber.
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

  if b.plan_tier <> 'none' and b.plan_credits > 0 then
    update public.billing set plan_credits = plan_credits - 1 where user_id = auth.uid() returning * into b;
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

-- Resets/rolls over plan credits for every subscriber whose renewal date has passed. Idempotent
-- and safe to run as often as we like — a row is only touched once its own plan_renews_at is due,
-- after which that date is pushed a month out.
create or replace function public.reset_due_plan_credits()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.billing b
  set plan_credits = case when cfg.rollover_cap = 0 then cfg.monthly_credits else least(b.plan_credits + cfg.monthly_credits, cfg.rollover_cap) end,
      plan_renews_at = b.plan_renews_at + interval '1 month'
  from public.plan_tier_config cfg
  where cfg.tier = b.plan_tier
    and b.plan_tier <> 'none'
    and b.plan_renews_at is not null
    and b.plan_renews_at <= now();
end;
$$;

-- Hourly is frequent enough that a renewal is never more than an hour late, without needing a
-- dedicated always-on process just to watch the clock.
create extension if not exists pg_cron;
select cron.schedule('reset-plan-credits', '0 * * * *', $$select public.reset_due_plan_credits();$$);
