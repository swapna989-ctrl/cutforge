-- Fourth of the Vugola-caption-editor-inspired features (new styles+fonts shipped in 0017).
-- 'auto' matches 'bottom' exactly -- today's existing, already-shipped placement, unchanged --
-- 'top'/'middle' are real new alternatives enforced by worker/src/ffmpeg.ts's
-- CAPTION_POSITION_SPECS, which is what actually renders each one.
alter table public.projects add column caption_position text not null default 'auto' check (
  caption_position in ('auto', 'top', 'middle', 'bottom')
);
