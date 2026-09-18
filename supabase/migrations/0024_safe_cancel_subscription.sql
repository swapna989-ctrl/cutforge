-- Cancel Plan is currently broken: it calls set_subscription_tier, which 0012 correctly locked
-- to service_role only (that function can also GRANT a paid tier with no payment check at all --
-- see 0012's comment -- so it can only safely run from a real payment webhook, not the browser).
-- Canceling has no such exploit: a user can only ever reduce their own plan to nothing, never
-- grant themselves anything, so it doesn't need to wait on real payment infrastructure the way
-- buying/subscribing does. This is a separate, narrowly-scoped function for exactly that one safe
-- action, kept grantable to `authenticated` since there's nothing here to protect against.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

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
  set plan_tier = 'none', plan_credits = 0, plan_renews_at = null
  where user_id = auth.uid()
  returning * into b;
  if b is null then
    raise exception 'No billing record for this user';
  end if;
  return b;
end;
$$;

grant execute on function public.cancel_my_subscription() to authenticated;
