-- Fifth of the Vugola-caption-editor-inspired features. 'auto' matches today's existing,
-- already-shipped chunking (~6 words/42 chars per burst, up to 2 lines), unchanged --
-- 'one_line'/'two_words'/'three_lines' are real new alternatives enforced by
-- worker/src/transcribe.ts's LINE_COUNT_BOUNDS, which is what actually renders each one.
-- 'two_words' is a genuinely different fast-paced mode (max 2 words per on-screen burst), not a
-- line-wrap-count variant of 'one_line'/'three_lines' -- the three options deliberately mix units.
alter table public.projects add column caption_line_count text not null default 'auto' check (
  caption_line_count in ('auto', 'one_line', 'two_words', 'three_lines')
);
