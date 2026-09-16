-- buy_credit_pack and set_subscription_tier only ever trusted auth.uid() to attribute the
-- change to "whoever is calling", with no payment verification anywhere in either function.
-- Granted to `authenticated`, that means any signed-in user could call them directly — and the
-- pricing page's own "Subscribe"/"Buy Credits" buttons do exactly that today, so this isn't a
-- theoretical dev-tools exploit, it's two live buttons that currently grant paid tiers/credits
-- for free. Revoking `authenticated` and granting `service_role` instead means these can only
-- run from trusted server-side code from now on — a future payment webhook that has already
-- verified a real charge, never directly from the browser. Same reasoning already applied to
-- charge_project_credits in 0009_duration_scaled_credits.sql.
revoke execute on function public.buy_credit_pack(integer) from authenticated;
grant execute on function public.buy_credit_pack(integer) to service_role;

revoke execute on function public.set_subscription_tier(text, text) from authenticated;
grant execute on function public.set_subscription_tier(text, text) to service_role;
