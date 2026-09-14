-- Ties credit cost to real video length instead of charging a flat 1 credit per video
-- regardless of duration. The dominant per-video cost (Whisper transcription + LLM clip
-- planning) scales with minutes of footage, not with "how many videos" — a flat charge meant a
-- 3-hour video could cost far more in real OpenAI usage than the credit(s) it consumed, a
-- structural loss on exactly the long-form content this product targets. 1 credit now = up to
-- 10 minutes of source video (CREDIT_SECONDS in src/lib/pricing.ts — keep both in sync).
--
-- Just as importantly, charging moves from the client (at submission, before a URL-ingested
-- video's real length is even known) to the worker (worker/src/pipeline.ts), at the exact point
-- the real duration is measured — right after download/normalize, before the metered Whisper/LLM
-- calls that actually cost money. A video that can't be paid for now fails fast, before those
-- calls ever run, instead of being processed on credit and hoping the balance was enough.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

alter table public.projects add column if not exists credits_charged integer not null default 0 check (credits_charged >= 0);

-- The old client-callable single-credit spend. Superseded for new submissions by
-- charge_project_credits below (worker-only), but kept — now duration-aware — for the one
-- remaining caller that still charges at download time instead of at worker processing time: the
-- legacy single-output "Download Master" flow (src/components/WorkspaceView.tsx), which predates
-- the AI Clip Planner and only ever runs for a project with zero generated shorts.
drop function if exists public.consume_export_credit();

create or replace function public.consume_export_credit(credits_needed integer)
returns public.billing
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.billing;
  from_plan integer := 0;
  from_paid integer := 0;
  from_free integer := 0;
  remaining integer;
begin
  if credits_needed is null or credits_needed <= 0 then
    raise exception 'Invalid credit amount';
  end if;
  remaining := credits_needed;

  select * into b from public.billing where user_id = auth.uid() for update;
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
    raise exception 'Not enough credits — need % more', remaining;
  end if;

  update public.billing
  set plan_credits = plan_credits - from_plan,
      paid_credits = paid_credits - from_paid,
      free_credits = free_credits - from_free
  where user_id = auth.uid()
  returning * into b;

  return b;
end;
$$;

grant execute on function public.consume_export_credit(integer) to authenticated;

-- The real charge point for every new (post-AI-Clip-Planner) project: called once by the worker,
-- right after it measures the source's actual duration, for however many credits that duration
-- costs. Takes a project id rather than a user id, and looks the owner up itself, specifically so
-- this can never be pointed at someone else's project/billing row by a caller who only controls
-- the arguments — hence granted to service_role only, never to authenticated.
--
-- Idempotent: a project already charged (credits_charged > 0) just returns what was already
-- decided, so a worker retry/resume can never double-charge the same project.
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

  credits_needed := greatest(1, ceil(p_duration_seconds / 600.0)::integer);
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
    raise exception 'INSUFFICIENT_CREDITS: this %-minute video needs % credit(s), only % available',
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

grant execute on function public.charge_project_credits(uuid, integer) to service_role;
