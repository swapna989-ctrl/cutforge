-- One-time credit packs are a premium top-up for people already on a paid plan, so the function
-- that grants one now refuses anyone whose plan_tier is 'none' (a free-tier account, or one whose
-- plan was cancelled or lapsed). The UI already hides packs from those accounts; this makes the
-- database enforce it too, so no path that reaches the grant, including a future payment webhook,
-- can hand one out.
--
-- Same signature, security definer, and service_role-only access as before (0012-0014); this only
-- adds the plan check. Idempotent: safe to run more than once. Run in the Supabase SQL editor.
--
-- If a payment-gateway migration later replaces this function (e.g. one that takes the user id as an
-- argument instead of reading auth.uid()), it has to keep this check, and whatever creates the order
-- should reject non-subscribers before charging anyone, since a payment taken for a pack that then
-- can't be granted would need refunding.
create or replace function public.buy_credit_pack(amount integer)
returns public.billing
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.billing;
begin
  if amount is null or amount <= 0 then
    raise exception 'Invalid credit amount';
  end if;

  select * into b from public.billing where user_id = auth.uid() for update;
  if b is null then
    raise exception 'No billing record for this user';
  end if;
  if b.plan_tier = 'none' then
    raise exception 'SUBSCRIPTION_REQUIRED: credit packs are only available on an active plan';
  end if;

  update public.billing set paid_credits = paid_credits + amount where user_id = auth.uid() returning * into b;
  return b;
end;
$$;
