-- Adds shorts.viral_score — an LLM-estimated 0-100 confidence score for how well a candidate
-- clip is likely to perform as a short-form video, produced by the same AI Clip Planner call
-- that already picks the candidates (see worker/src/clipPlanner.ts). Purely additive.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

alter table public.shorts
  add column if not exists viral_score integer check (viral_score is null or viral_score between 0 and 100);
