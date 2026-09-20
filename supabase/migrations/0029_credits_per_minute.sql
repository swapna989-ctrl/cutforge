-- Changes the credit unit: 1 credit used to cover up to 10 minutes of source video; now a video burns
-- 15 credits for every started minute (so 100 minutes = 1,500 credits). Old and new amounts are the
-- same value: one old credit (10 minutes) is 150 new credits (10 minutes x 15).
--
-- What this does, in order:
--   1. Converts everything that holds credits from the old unit to the new one (x150), exactly once:
--      every account's balances, the plan allowances and rollover caps, and the credit figures kept
--      on past projects and payments so their history still reads correctly. Nobody gains or loses
--      anything. The conversion is guarded, so running this file a second time changes nothing.
--   2. A new account now starts with 150 free credits (was 1), the same 10 minutes as before.
--   3. charge_project_credits charges 15 per started minute (was 1 per 10 minutes, minimum 1).
--   4. Re-generating one clip costs 15 credits (was 1). That's the price of about a minute of video;
--      1 old credit would now be 150, far more than the roughly rupee it costs to re-render a clip.
--
-- The plan allowances and pack sizes shown on the site live in src/lib/pricing.ts (CREDITS_PER_MINUTE,
-- REGENERATE_CREDITS, FREE_SIGNUP_CREDITS, TIER_CONFIG, CREDIT_PACKS); keep them in step with this file.
--
-- Run this in the Supabase SQL editor BEFORE the matching site/worker code is deployed: until the code
-- catches up, a stale page just shows old-unit wording, whereas new code against unconverted balances
-- would wrongly tell people they can't afford anything.

do $$
begin
  -- Convert only if the old Starter allowance (10 credits) is still there, i.e. this hasn't run yet.
  if (select monthly_credits from public.plan_tier_config where tier = 'starter') = 10 then
    update public.billing
    set free_credits = free_credits * 150,
        paid_credits = paid_credits * 150,
        plan_credits = plan_credits * 150;

    update public.projects set credits_charged = credits_charged * 150 where credits_charged > 0;

    -- Pack purchases (paid, and any order still waiting to be paid) keep the value they were bought at.
    update public.payments set credit_amount = credit_amount * 150 where credit_amount is not null;

    update public.plan_tier_config
    set monthly_credits = monthly_credits * 150,
        rollover_cap = rollover_cap * 150;
  end if;
end
$$;

alter table public.billing alter column free_credits set default 150;

create or replace function public.charge_project_credits(p_project_id uuid, p_duration_seconds integer)
returns table (charged_credits integer, watermark_free boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  proj record;
  b public.billing;
  credits_needed integer;
  from_plan integer := 0;
  from_paid integer := 0;
  from_free integer := 0;
  remaining integer;
begin
  select id, user_id, credits_charged, watermark into proj from public.projects where id = p_project_id for update;
  if proj is null then
    raise exception 'No project %', p_project_id;
  end if;

  if proj.credits_charged > 0 then
    return query select proj.credits_charged, not proj.watermark;
    return;
  end if;

  -- 15 credits for every started minute, at least one minute. CREDITS_PER_MINUTE in src/lib/pricing.ts
  -- and worker/src/credits.ts must match.
  credits_needed := greatest(1, ceil(p_duration_seconds / 60.0)::integer) * 15;
  remaining := credits_needed;

  select * into b from public.billing where user_id = proj.user_id for update;
  if b is null then
    raise exception 'No billing record for this user';
  end if;

  if b.plan_tier <> 'none' and b.plan_credits > 0 then
    from_plan := least(b.plan_credits, remaining);
    remaining := remaining - from_plan;
  end if;
  if remaining > 0 and b.paid_credits > 0 then
    from_paid := least(b.paid_credits, remaining);
    remaining := remaining - from_paid;
  end if;
  if remaining > 0 and b.free_credits > 0 then
    from_free := least(b.free_credits, remaining);
    remaining := remaining - from_free;
  end if;
  if remaining > 0 then
    raise exception 'INSUFFICIENT_CREDITS: this %-minute video needs % credits, only % available',
      ceil(p_duration_seconds / 60.0)::integer, credits_needed, credits_needed - remaining;
  end if;

  update public.billing
  set plan_credits = plan_credits - from_plan,
      paid_credits = paid_credits - from_paid,
      free_credits = free_credits - from_free
  where user_id = proj.user_id;

  -- Watermark-free only when at least part of the charge came from a real (plan or paid) credit
  -- — a charge paid entirely out of free credits still carries the watermark, same rule as before.
  update public.projects
  set credits_charged = credits_needed, watermark = (from_plan = 0 and from_paid = 0)
  where id = p_project_id;

  return query select credits_needed, (from_plan > 0 or from_paid > 0);
end;
$$;

create or replace function public.charge_short_regenerate_credit(p_short_id uuid)
returns table (charged_credits integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  sh record;
  proj record;
  b public.billing;
  from_plan integer := 0;
  from_paid integer := 0;
  from_free integer := 0;
  -- REGENERATE_CREDITS in src/lib/pricing.ts must match.
  remaining integer := 15;
begin
  select id, project_id into sh from public.shorts where id = p_short_id for update;
  if sh is null then
    raise exception 'No short %', p_short_id;
  end if;

  select id, user_id into proj from public.projects where id = sh.project_id;
  if proj is null then
    raise exception 'No project for short %', p_short_id;
  end if;

  select * into b from public.billing where user_id = proj.user_id for update;
  if b is null then
    raise exception 'No billing record for this user';
  end if;

  if b.plan_tier <> 'none' and b.plan_credits > 0 then
    from_plan := least(b.plan_credits, remaining);
    remaining := remaining - from_plan;
  end if;
  if remaining > 0 and b.paid_credits > 0 then
    from_paid := least(b.paid_credits, remaining);
    remaining := remaining - from_paid;
  end if;
  if remaining > 0 and b.free_credits > 0 then
    from_free := least(b.free_credits, remaining);
    remaining := remaining - from_free;
  end if;
  if remaining > 0 then
    raise exception 'INSUFFICIENT_CREDITS: regenerating this clip needs 15 credits';
  end if;

  update public.billing
  set plan_credits = plan_credits - from_plan,
      paid_credits = paid_credits - from_paid,
      free_credits = free_credits - from_free
  where user_id = proj.user_id;

  return query select 15;
end;
$$;

-- create or replace keeps the existing permissions; stated again so this file alone guarantees them.
-- Only the server (service_role: the worker) ever charges credits, never a signed-in user.
revoke execute on function public.charge_project_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.charge_project_credits(uuid, integer) to service_role;
revoke execute on function public.charge_short_regenerate_credit(uuid) from public, anon, authenticated;
grant execute on function public.charge_short_regenerate_credit(uuid) to service_role;
