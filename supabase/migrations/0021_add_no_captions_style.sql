-- Adds "none" as a real caption style value -- for users who'll caption elsewhere or don't want
-- captions at all. worker/src/ffmpeg.ts's finalizeVideo skips the subtitles filter entirely (and
-- worker/src/pipeline.ts + regenerate.ts skip the Whisper transcription call too, since nothing
-- will read its output) when this is selected -- watermarking is unaffected, since it's an
-- unrelated paywall concern, not a caption one.

alter table public.projects drop constraint projects_caption_style_check;
alter table public.projects add constraint projects_caption_style_check check (
  caption_style in ('none', 'classic', 'bold_yellow', 'rose', 'glow', 'punch', 'minimalist', 'vlog')
);

-- shorts.caption_style is a nullable per-short override (null = inherit the project's default,
-- see 0020_short_editing.sql) -- this constraint only ever runs against non-null values, same as
-- every other nullable override column added there.
alter table public.shorts drop constraint shorts_caption_style_check;
alter table public.shorts add constraint shorts_caption_style_check check (
  caption_style in ('none', 'classic', 'bold_yellow', 'rose', 'glow', 'punch', 'minimalist', 'vlog')
);
