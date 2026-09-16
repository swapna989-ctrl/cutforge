-- Real payment processing (Razorpay, India/INR first) replacing the dead-end direct-RPC calls
-- the pricing page used before 0012-0014 locked them down. See 0015's companion plan for the
-- full design; this migration covers the database side.

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

-- Both buy_credit_pack and set_subscription_tier previously identified their target row via
-- auth.uid() — fine when the caller was the signed-in user themselves, but that caller no longer
-- exists: both are service_role-only since 0012-0014, and their only future caller is
-- process_razorpay_payment below, acting on behalf of whichever user actually paid. Widening the
-- signature to take that user id explicitly is safe precisely because nothing client-facing calls
-- either function anymore. Drops the old signatures explicitly so they don't linger as confusing
-- unused overloads.
drop function if exists public.buy_credit_pack(integer);

create function public.buy_credit_pack(p_user_id uuid, amount integer)
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
  update public.billing set paid_credits = paid_credits + amount where user_id = p_user_id returning * into b;
  if b is null then
    raise exception 'No billing record for this user';
  end if;
  return b;
end;
$$;

revoke execute on function public.buy_credit_pack(uuid, integer) from public;
revoke execute on function public.buy_credit_pack(uuid, integer) from anon;
grant execute on function public.buy_credit_pack(uuid, integer) to service_role;

drop function if exists public.set_subscription_tier(text, text);

-- Fixes a real bug alongside the signature change: plan_renews_at was hardcoded to "+1 month"
-- regardless of new_cycle, so a yearly subscriber would already look "due" after one month once
-- reset_due_plan_credits below actually starts gating renewal on payment.
create function public.set_subscription_tier(p_user_id uuid, new_tier text, new_cycle text default 'monthly')
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

  update public.billing
  set plan_tier = new_tier,
      billing_cycle = new_cycle,
      plan_credits = cfg.monthly_credits,
      plan_renews_at = now() + (case when new_cycle = 'yearly' then interval '1 year' else interval '1 month' end)
  where user_id = p_user_id
  returning * into b;
  if b is null then
    raise exception 'No billing record for this user';
  end if;
  return b;
end;
$$;

revoke execute on function public.set_subscription_tier(uuid, text, text) from public;
revoke execute on function public.set_subscription_tier(uuid, text, text) from anon;
grant execute on function public.set_subscription_tier(uuid, text, text) to service_role;

-- The single place both the client-verify route and the Razorpay webhook call — whichever fires
-- first does the real work, the other gets a harmless no-op. That's what makes webhook retries
-- and a verify-call racing the webhook both safe, without either path needing its own locking.
create function public.process_razorpay_payment(p_order_id text, p_razorpay_payment_id text)
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

revoke execute on function public.process_razorpay_payment(text, text) from public;
revoke execute on function public.process_razorpay_payment(text, text) from anon;
grant execute on function public.process_razorpay_payment(text, text) to service_role;

-- Previously extended plan_renews_at and refilled credits for every due row unconditionally —
-- confirmed via this function's own prior comment ("pushed a month out") that renewal was never
-- actually gated on payment. Now downgrades instead: a plan lapses on its renewal date unless a
-- new payment (via process_razorpay_payment -> set_subscription_tier) already pushed
-- plan_renews_at forward before the cron sweep runs.
create or replace function public.reset_due_plan_credits()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.billing
  set plan_tier = 'none', plan_credits = 0, plan_renews_at = null
  where plan_tier <> 'none'
    and plan_renews_at is not null
    and plan_renews_at <= now();
end;
$$;

revoke execute on function public.reset_due_plan_credits() from public;
revoke execute on function public.reset_due_plan_credits() from anon;
