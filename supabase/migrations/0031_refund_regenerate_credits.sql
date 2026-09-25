-- Same gap as 0030, for the other place credits get charged: regenerating one already-made short
-- (a caption/ratio/crop edit). If that regenerate fails, the short already correctly reverts to its
-- last good version (see regenerate.ts) -- but the 15 credits charged for the attempt stayed gone.
--
-- This works differently from a project's charge, which happens exactly once, ever, per project.
-- A short can be regenerated many times over its life, each a fresh 15-credit charge, so there's no
-- single lifetime "was this charged" flag to hang a refund off. Instead, each charge overwrites a
-- short's own "most recent charge" record (split + not-yet-refunded) -- correct because only one
-- regenerate can ever be in flight for a given short at a time (see claimNextShortRegenerate), so
-- refund_short_regenerate_credit only ever needs to know about the latest one.

alter table public.shorts
  add column if not exists regenerate_credits_charged integer not null default 0,
  add column if not exists regenerate_credits_charged_from_plan integer not null default 0,
  add column if not exists regenerate_credits_charged_from_paid integer not null default 0,
  add column if not exists regenerate_credits_charged_from_free integer not null default 0,
  -- true = nothing outstanding to refund -- true by default (a short that's never been regenerated
  -- has nothing pending), flipped to false by every fresh charge, back to true once refunded.
  add column if not exists regenerate_credits_refunded boolean not null default true;

-- Same signature as before (create or replace keeps its existing service_role-only grant) -- the
-- only change is recording this attempt's split onto the short, overwriting whatever the short's
-- previous regenerate attempt (if any) left there.
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

  update public.shorts
  set regenerate_credits_charged = 15,
      regenerate_credits_charged_from_plan = from_plan,
      regenerate_credits_charged_from_paid = from_paid,
      regenerate_credits_charged_from_free = from_free,
      regenerate_credits_refunded = false
  where id = p_short_id;

  return query select 15;
end;
$$;

-- Puts back the most recent regenerate charge on this short, into the exact plan/paid/free buckets
-- it came from. The worker only ever calls this in the same invocation that just charged and then
-- failed (never blindly on every failure), so it can't refund a stale charge from an earlier,
-- already-successful regenerate -- but the guard here is what makes a second call, or a call for a
-- short that's never charged anything, a safe no-op regardless.
create or replace function public.refund_short_regenerate_credit(p_short_id uuid)
returns table (refunded_credits integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  sh record;
  proj record;
begin
  select id, project_id, regenerate_credits_charged, regenerate_credits_charged_from_plan,
         regenerate_credits_charged_from_paid, regenerate_credits_charged_from_free, regenerate_credits_refunded
    into sh from public.shorts where id = p_short_id for update;
  if sh is null then
    raise exception 'No short %', p_short_id;
  end if;

  if sh.regenerate_credits_refunded or sh.regenerate_credits_charged = 0 then
    update public.shorts set regenerate_credits_refunded = true where id = p_short_id;
    return query select 0;
    return;
  end if;

  select id, user_id into proj from public.projects where id = sh.project_id;
  if proj is null then
    raise exception 'No project for short %', p_short_id;
  end if;

  update public.billing
  set plan_credits = plan_credits + sh.regenerate_credits_charged_from_plan,
      paid_credits = paid_credits + sh.regenerate_credits_charged_from_paid,
      free_credits = free_credits + sh.regenerate_credits_charged_from_free
  where user_id = proj.user_id;

  update public.shorts set regenerate_credits_refunded = true where id = p_short_id;

  return query select sh.regenerate_credits_charged;
end;
$$;

revoke execute on function public.charge_short_regenerate_credit(uuid) from public, anon, authenticated;
grant execute on function public.charge_short_regenerate_credit(uuid) to service_role;
revoke execute on function public.refund_short_regenerate_credit(uuid) from public, anon, authenticated;
grant execute on function public.refund_short_regenerate_credit(uuid) to service_role;
