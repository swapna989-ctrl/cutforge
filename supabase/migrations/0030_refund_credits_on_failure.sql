-- Today, a project that's charged and then fails outright (every planned short fails to render, or
-- the job dies before any short even gets created) keeps the charge. The user paid for a video and
-- got nothing -- charge_project_credits was already correct to charge before the expensive
-- Whisper/LLM calls run (so an unaffordable video is refused cheaply), but "charged" was never
-- meant to survive a total failure with zero deliverable output.
--
-- This does two things:
--   1. Records exactly how a charge was split across plan/paid/free credits at the moment it's
--      charged (charge_project_credits already computes this split internally -- it just never
--      persisted it), so a refund can put credits back in the exact same buckets they came from,
--      not guess by dumping the total into one bucket.
--   2. Adds refund_project_credits(project_id), called by the worker only when a job ends in
--      pipeline_status='failed'. Idempotent (credits_refunded guards it), and a safe no-op for a
--      project that was never charged in the first place (failed before reaching the charge, or
--      blocked-and-retried, which never charges at all).

alter table public.projects
  add column if not exists credits_charged_from_plan integer not null default 0,
  add column if not exists credits_charged_from_paid integer not null default 0,
  add column if not exists credits_charged_from_free integer not null default 0,
  add column if not exists credits_refunded boolean not null default false;

-- Same signature as before (create or replace keeps its existing service_role-only grant) -- the
-- only change is persisting from_plan/from_paid/from_free onto the project row it already touches.
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
  set credits_charged = credits_needed,
      watermark = (from_plan = 0 and from_paid = 0),
      credits_charged_from_plan = from_plan,
      credits_charged_from_paid = from_paid,
      credits_charged_from_free = from_free
  where id = p_project_id;

  return query select credits_needed, (from_plan > 0 or from_paid > 0);
end;
$$;

-- Puts back exactly what charge_project_credits took, into the exact same plan/paid/free buckets --
-- called by the worker when a project ends in pipeline_status='failed', regardless of whether that
-- failure happened before any short was created or after every short failed to render. A project
-- that was never charged (failed before the charge step, or is still on a blocked-retry cycle,
-- which never charges at all) safely refunds 0 and is marked refunded so it's never revisited.
create or replace function public.refund_project_credits(p_project_id uuid)
returns table (refunded_credits integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  proj record;
begin
  select id, user_id, credits_charged, credits_charged_from_plan, credits_charged_from_paid,
         credits_charged_from_free, credits_refunded
    into proj from public.projects where id = p_project_id for update;
  if proj is null then
    raise exception 'No project %', p_project_id;
  end if;

  -- Already refunded (a retried failure path calling this twice) or never charged in the first
  -- place -- either way, nothing left to do, and marking it refunded stops it being revisited.
  if proj.credits_refunded or proj.credits_charged = 0 then
    update public.projects set credits_refunded = true where id = p_project_id;
    return query select 0;
    return;
  end if;

  update public.billing
  set plan_credits = plan_credits + proj.credits_charged_from_plan,
      paid_credits = paid_credits + proj.credits_charged_from_paid,
      free_credits = free_credits + proj.credits_charged_from_free
  where user_id = proj.user_id;

  update public.projects set credits_refunded = true where id = p_project_id;

  return query select proj.credits_charged;
end;
$$;

-- Server-only, same as every other billing function -- never a signed-in user directly.
revoke execute on function public.charge_project_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.charge_project_credits(uuid, integer) to service_role;
revoke execute on function public.refund_project_credits(uuid) from public, anon, authenticated;
grant execute on function public.refund_project_credits(uuid) to service_role;
