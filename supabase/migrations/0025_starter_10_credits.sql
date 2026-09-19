-- Starter's monthly allowance drops from 15 to 10 credits (1 credit = 10 minutes of video, so 100
-- minutes a month). Creator (45) and Agency (120) are unchanged; they're restated here so this one
-- statement makes plan_tier_config match TIER_CONFIG in src/lib/pricing.ts exactly.
--
-- Only plan_tier_config needs to change: set_subscription_tier (a new subscription's first
-- allowance) and reset_due_plan_credits (every renewal after that) both read it, so neither
-- function is touched. Someone already on Starter keeps whatever credits they hold until their
-- next renewal, when reset_due_plan_credits resets them to 10 (Starter has no rollover).
--
-- Credit pack sizes and every price live only in src/lib/pricing.ts, not in the database, so
-- nothing else here changes. Idempotent: safe to run more than once.
insert into public.plan_tier_config (tier, monthly_credits, rollover_cap) values
  ('starter', 10, 0),
  ('creator', 45, 90),
  ('agency', 120, 240)
on conflict (tier) do update set monthly_credits = excluded.monthly_credits, rollover_cap = excluded.rollover_cap;
