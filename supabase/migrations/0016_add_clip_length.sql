-- Second of three clipspeed.ai-inspired features (1:1 ratio shipped in 0015). Lets a user pick
-- what duration range the AI clip planner targets, instead of the fixed 30-90s every project got
-- before -- 'auto' is that exact same 30-90s default, unchanged; 'short'/'long' are real new
-- ranges enforced by worker/src/clipPlanner.ts's CLIP_LENGTH_BOUNDS.
alter table public.projects add column clip_length text not null default 'auto' check (clip_length in ('auto', 'short', 'long'));
