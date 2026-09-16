-- Adds 1:1 Square as a third output format alongside 9:16/16:9. The exact constraint name below
-- was confirmed against the live database (a real insert attempt naming it in the violation
-- error) rather than assumed from Postgres's usual auto-naming convention.
alter table public.projects drop constraint projects_ratio_check;
alter table public.projects add constraint projects_ratio_check check (ratio in ('9:16', '16:9', '1:1'));
