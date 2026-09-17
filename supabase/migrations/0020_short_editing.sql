-- Makes the Edit/Crop buttons on a generated short real. Two prerequisites:
--
-- 1. projects.trimmed_key persists the dead-air-trimmed source the worker already builds for
--    every job (worker/src/pipeline.ts's trimmedPath) instead of discarding it — a short's own
--    source_start_seconds/source_end_seconds are positions in THAT timeline, not the raw upload,
--    so re-editing a short later requires this exact file to still exist.
--
-- 2. Per-short nullable overrides on `shorts`, mirroring the matching `projects` columns exactly
--    (same allowed values) -- null means "inherit the project's current default", same pattern
--    already used for fontOverride in worker/src/ffmpeg.ts. crop_x/crop_y are new: a manual crop
--    center as a fraction of the source frame (same convention detectFaceCenterFraction already
--    returns in worker/src/faceCrop.ts), null meaning "keep auto face-detection". preview_frame_key
--    is set once the worker has extracted an uncropped representative frame for the crop tool to
--    show. Editing one short never touches its siblings or the project's own defaults.

alter table public.projects add column trimmed_key text;

alter table public.shorts add column caption_style text check (
  caption_style in ('classic', 'bold_yellow', 'rose', 'glow', 'punch', 'minimalist', 'vlog')
);
alter table public.shorts add column caption_font text check (
  caption_font in ('geist', 'montserrat', 'poppins', 'fredoka', 'pt_serif', 'roboto', 'ubuntu', 'zalando_sans', 'cormorant_garamond')
);
alter table public.shorts add column caption_position text check (
  caption_position in ('auto', 'top', 'middle', 'bottom')
);
alter table public.shorts add column caption_language text check (
  caption_language in ('auto', 'hinglish')
);
alter table public.shorts add column caption_line_count text check (
  caption_line_count in ('auto', 'one_line', 'two_words', 'three_lines')
);
alter table public.shorts add column ratio text check (ratio in ('9:16', '16:9', '1:1'));
alter table public.shorts add column crop_x double precision check (crop_x >= 0 and crop_x <= 1);
alter table public.shorts add column crop_y double precision check (crop_y >= 0 and crop_y <= 1);
alter table public.shorts add column preview_frame_key text;

-- 'regenerating' is a short's own version of projects.pipeline_status's 'queued' -- something the
-- frontend sets, that only the worker's poll loop claims and moves onward from. The exact
-- constraint name below was confirmed against the live database (a real insert attempt naming it
-- in the violation error) rather than assumed from Postgres's usual auto-naming convention.
alter table public.shorts drop constraint shorts_status_check;
alter table public.shorts add constraint shorts_status_check check (
  status in ('pending', 'processing', 'ready', 'failed', 'regenerating')
);

-- Flat 1-credit charge for regenerating one already-rendered short (real repeat Whisper +
-- render cost each time, confirmed with the user, deliberately flat rather than duration-scaled
-- like charge_project_credits -- these are short clips, not full source videos). Modeled directly
-- on charge_project_credits (supabase/migrations/0009_duration_scaled_credits.sql): same
-- plan_credits -> paid_credits -> free_credits draw-down order, same INSUFFICIENT_CREDITS:
-- prefixed error, security definer, granted to service_role only -- called from the worker right
-- before it re-runs the metered Whisper/render calls, never directly from the browser, same
-- reasoning as the RPC lockdown in 0012-0014. No watermark decision here (unlike the project-level
-- charge) -- a regenerated short just reads the project's own current watermark value, same as
-- any other render; keeping this RPC to exactly one job (charge 1 credit) was a deliberate,
-- explicit simplicity call.
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
  remaining integer := 1;
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
    raise exception 'INSUFFICIENT_CREDITS: regenerating this clip needs 1 credit';
  end if;

  update public.billing
  set plan_credits = plan_credits - from_plan,
      paid_credits = paid_credits - from_paid,
      free_credits = free_credits - from_free
  where user_id = proj.user_id;

  return query select 1;
end;
$$;

grant execute on function public.charge_short_regenerate_credit(uuid) to service_role;
