-- Cuts the free-trial signup grant from 5 credits (up to 50 min of real processing) down to 1
-- (up to 10 min) -- enough to genuinely try the product, not enough to make farming several
-- throwaway accounts worthwhile. Only changes the DEFAULT applied to *new* rows: existing users
-- keep whatever free_credits balance they currently have, this never claws anything back.
--
-- handle_new_user_billing() (0002_billing.sql) inserts a billing row with no explicit
-- free_credits value, so it always takes this column default -- no trigger change needed.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

alter table public.billing alter column free_credits set default 1;
