-- Locks every function that grants or spends credits/plans to service_role only.
--
-- Found by calling them as a signed-in free user: these were executable by the `authenticated` role,
-- i.e. by anyone with an account, straight from the browser:
--   * buy_credit_pack(uuid, integer)            -> grant yourself any number of paid credits
--   * set_subscription_tier(uuid, text, text)   -> give yourself a paid plan for free
--   * process_razorpay_payment(text, text)      -> settle an order without paying
--   * charge_project_credits(uuid, integer)     -> pre-charge a project a token amount, so the real
--                                                   charge for a long video is skipped as "already paid"
--   * charge_short_regenerate_credit(uuid)      -> (also open to anon)
--   * reset_due_plan_credits()
--   * buy_credit_pack(integer)                  -> created unlocked by 0026 on a database whose old
--                                                   version had been replaced by the payments migration
-- The payments migration revoked them from `public` and `anon` but not from `authenticated`, and
-- 0009/0020 granted the charge functions to service_role without revoking anyone else. Revoking from
-- `public` does not remove a grant made explicitly to `authenticated`, which Supabase adds by default.
--
-- Only the server (service_role: the worker and the payment routes) ever needs to call these.
-- consume_export_credit(integer) and cancel_my_subscription() stay open to signed-in users on purpose:
-- neither can give anyone anything. pg_cron runs reset_due_plan_credits as the database owner, so it
-- is unaffected.
--
-- Written to work on either schema in circulation (with or without the payments migration): a
-- signature that doesn't exist is skipped. Idempotent; run in the Supabase SQL editor.
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'public.buy_credit_pack(integer)',
    'public.buy_credit_pack(uuid, integer)',
    'public.set_subscription_tier(text, text)',
    'public.set_subscription_tier(uuid, text, text)',
    'public.process_razorpay_payment(text, text)',
    'public.reset_due_plan_credits()',
    'public.charge_project_credits(uuid, integer)',
    'public.charge_short_regenerate_credit(uuid)'
  ] loop
    if to_regprocedure(sig) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', sig);
      execute format('grant execute on function %s to service_role', sig);
    end if;
  end loop;
end
$$;
