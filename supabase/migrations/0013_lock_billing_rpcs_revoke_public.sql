-- 0012 revoked execute from `authenticated` on buy_credit_pack/set_subscription_tier, but that
-- alone did nothing: Postgres grants EXECUTE on every new function to the PUBLIC pseudo-role
-- automatically at creation time, and no earlier migration ever revoked that default. Any role
-- can use a privilege granted to PUBLIC regardless of its own specific grants — confirmed by
-- calling every security-definer RPC in this project as the fully unauthenticated `anon` role
-- (never explicitly granted access to any of them) and finding four still reachable, plus by the
-- account holder still being able to click "Subscribe" on the pricing page after 0012 shipped.
--
-- The worst of the four: charge_project_credits has no ownership check in its body at all — it
-- charges whatever user_id owns the p_project_id it's given, trusting that only the worker would
-- ever call it with a project it just measured itself. Left reachable, any authenticated (or, via
-- the same PUBLIC leak, fully anonymous) caller could drain an arbitrary other user's credits by
-- passing someone else's project id directly. reset_due_plan_credits has no per-user scoping
-- either (it bulk-processes every row currently due), so it's not a targeted drain, but it still
-- has no business being callable outside its own hourly cron job. consume_export_credit is the
-- one exception that's supposed to stay client-callable (the legacy download-time flow in
-- WorkspaceView calls it directly) — it only needed the anon-shaped hole closed, not the
-- authenticated one.
revoke execute on function public.buy_credit_pack(integer) from public;
revoke execute on function public.set_subscription_tier(text, text) from public;

revoke execute on function public.charge_project_credits(uuid, integer) from public;

revoke execute on function public.reset_due_plan_credits() from public;

revoke execute on function public.consume_export_credit(integer) from public;
grant execute on function public.consume_export_credit(integer) to authenticated;
