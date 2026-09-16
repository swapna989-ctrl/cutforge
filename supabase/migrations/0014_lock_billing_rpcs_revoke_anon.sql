-- 0013 revoked execute from PUBLIC, but has_function_privilege('anon', ...) still came back true
-- afterward — proof that anon holds its own DIRECT execute grant, separate from (and unaffected
-- by revoking) the plain Postgres PUBLIC default. This is Supabase's own project bootstrap: new
-- projects run an ALTER DEFAULT PRIVILEGES rule that auto-grants anon/authenticated/service_role
-- their own execute rights on every function created afterward, layered on top of the ordinary
-- PUBLIC grant. Revoking authenticated (0012) worked — confirmed via has_function_privilege
-- returning false — because that revoke targeted the right role directly. anon was never
-- targeted directly until now.
revoke execute on function public.buy_credit_pack(integer) from anon;
revoke execute on function public.set_subscription_tier(text, text) from anon;
revoke execute on function public.charge_project_credits(uuid, integer) from anon;
revoke execute on function public.reset_due_plan_credits() from anon;
revoke execute on function public.consume_export_credit(integer) from anon;
