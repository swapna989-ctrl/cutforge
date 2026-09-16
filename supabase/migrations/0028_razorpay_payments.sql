-- Real payments (Razorpay, India/INR): the payments ledger, the server-only functions that grant a
-- plan or credits once a payment is verified, and the renewal sweep. Run in the Supabase SQL editor.
--
-- This started as the payments branch's own "0015" migration. The live database already ran that
-- original, so this file is written to be run on top of it (and on a fresh database) safely, and it
-- corrects four things the original got wrong:
--
--   1. Access. The original revoked its functions from `public` and `anon` but not from
--      `authenticated`, which Supabase grants explicitly by default, so any signed-in user could call
--      them from the browser and grant themselves plans or credits (0027 closed that on the live
--      database). Every function here is now revoked from all three and granted to service_role only.
--   2. Yearly plans. A payment set plan_credits once and the sweep only ever downgraded, so a yearly
--      subscriber got one month of credits for a year's price. plan_expires_at (the end of the period
--      paid for) is new, and plan_renews_at now means "next credit refill": a yearly plan refills
--      every month until it expires, a monthly plan ends at its first renewal date unless paid again.
--   3. Rollover. Paying again reset credits to the monthly amount, so the advertised "rollover up to
--      2x unused credits" never happened. Renewing the same tier now carries unused credits over up
--      to that tier's cap, as the old monthly sweep used to.
--   4. Credit packs are only for people on an active plan; buy_credit_pack refuses anyone else.
--
-- A payment always starts a fresh period from the moment it's processed (paying early doesn't add on
-- to the time left), which is why the pricing page only offers Renew in a plan's last week.

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  razorpay_order_id text not null unique,
  razorpay_payment_id text unique,
  kind text not null check (kind in ('subscription', 'credit_pack')),
  tier text,
  billing_cycle text,
  credit_amount integer,
  amount_paise integer not null check (amount_paise > 0),
  status text not null default 'created' check (status in ('created', 'paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- RLS enabled with zero policies: this table is never read or written directly by a client, only
-- through the create-order/verify/webhook API routes acting as service_role. Same "closed by
-- default" pattern already used for plan_tier_config.
alter table public.payments enable row level security;

create index if not exists payments_user_id_idx on public.payments (user_id);

-- The end of the period paid for. plan_renews_at (already there) is the next monthly credit refill.
-- Null on a plan that predates this column, which is treated as ending at plan_renews_at.
alter table public.billing add column if not exists plan_expires_at timestamptz;

-- The old auth.uid()-based signatures. Nothing client-facing calls these any more (checkout grants
-- through process_razorpay_payment below), so they're dropped rather than left as unused overloads.
drop function if exists public.buy_credit_pack(integer);
drop function if exists public.set_subscription_tier(text, text);

create or replace function public.buy_credit_pack(p_user_id uuid, amount integer)
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

  select * into b from public.billing where user_id = p_user_id for update;
  if b is null then
    raise exception 'No billing record for this user';
  end if;
  if b.plan_tier = 'none' then
    raise exception 'SUBSCRIPTION_REQUIRED: credit packs are only available on an active plan';
  end if;

  update public.billing set paid_credits = paid_credits + amount where user_id = p_user_id returning * into b;
  return b;
end;
$$;

create or replace function public.set_subscription_tier(p_user_id uuid, new_tier text, new_cycle text default 'monthly')
returns public.billing
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.billing;
  cfg public.plan_tier_config;
  credits integer;
begin
  if new_tier = 'none' then
    update public.billing
    set plan_tier = 'none', plan_credits = 0, plan_renews_at = null, plan_expires_at = null
    where user_id = p_user_id
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

  select * into b from public.billing where user_id = p_user_id for update;
  if b is null then
    raise exception 'No billing record for this user';
  end if;

  -- Renewing the tier you're already on carries unused credits over (up to the tier's cap); a new
  -- or different tier starts from its full monthly allowance.
  if b.plan_tier = new_tier and cfg.rollover_cap > 0 then
    credits := least(b.plan_credits + cfg.monthly_credits, cfg.rollover_cap);
  else
    credits := cfg.monthly_credits;
  end if;

  update public.billing
  set plan_tier = new_tier,
      billing_cycle = new_cycle,
      plan_credits = credits,
      plan_renews_at = now() + interval '1 month',
      plan_expires_at = now() + (case when new_cycle = 'yearly' then interval '1 year' else interval '1 month' end)
  where user_id = p_user_id
  returning * into b;
  return b;
end;
$$;

-- The single place both the client-verify route and the Razorpay webhook call — whichever fires
-- first does the real work, the other gets a harmless no-op. That's what makes webhook retries
-- and a verify-call racing the webhook both safe, without either path needing its own locking. The
-- whole function is one transaction, so if the grant below raises, the payment stays unpaid and a
-- retry can try again.
create or replace function public.process_razorpay_payment(p_order_id text, p_razorpay_payment_id text)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
begin
  select * into p from public.payments where razorpay_order_id = p_order_id for update;
  if p is null then
    raise exception 'No payment record for order %', p_order_id;
  end if;

  if p.status = 'paid' then
    return p;
  end if;

  update public.payments
  set status = 'paid', razorpay_payment_id = p_razorpay_payment_id, paid_at = now()
  where id = p.id
  returning * into p;

  if p.kind = 'credit_pack' then
    perform public.buy_credit_pack(p.user_id, p.credit_amount);
  else
    perform public.set_subscription_tier(p.user_id, p.tier, p.billing_cycle);
  end if;

  return p;
end;
$$;

-- Hourly (pg_cron, 0008). First ends any plan whose paid period is over; then, for plans still paid
-- up but past their monthly refill date (a yearly plan), refills the month's credits. A monthly plan
-- never reaches the second step: its renewal date and its end date are the same moment.
create or replace function public.reset_due_plan_credits()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.billing
  set plan_tier = 'none', plan_credits = 0, plan_renews_at = null, plan_expires_at = null
  where plan_tier <> 'none'
    and coalesce(plan_expires_at, plan_renews_at) <= now();

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

-- 0024's cancel, now also clearing the new column.
create or replace function public.cancel_my_subscription()
returns public.billing
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.billing;
begin
  update public.billing
  set plan_tier = 'none', plan_credits = 0, plan_renews_at = null, plan_expires_at = null
  where user_id = auth.uid()
  returning * into b;
  if b is null then
    raise exception 'No billing record for this user';
  end if;
  return b;
end;
$$;

-- Server-only: revoked from `authenticated` as well as `public` and `anon` (see point 1 above).
revoke execute on function public.buy_credit_pack(uuid, integer) from public, anon, authenticated;
grant execute on function public.buy_credit_pack(uuid, integer) to service_role;

revoke execute on function public.set_subscription_tier(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_subscription_tier(uuid, text, text) to service_role;

revoke execute on function public.process_razorpay_payment(text, text) from public, anon, authenticated;
grant execute on function public.process_razorpay_payment(text, text) to service_role;

revoke execute on function public.reset_due_plan_credits() from public, anon, authenticated;
grant execute on function public.reset_due_plan_credits() to service_role;

-- Canceling stays open to signed-in users on purpose: it can only ever reduce their own plan.
revoke execute on function public.cancel_my_subscription() from public, anon;
grant execute on function public.cancel_my_subscription() to authenticated;
