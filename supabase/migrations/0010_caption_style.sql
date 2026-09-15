-- Lets a user choose a caption preset (see worker/src/ffmpeg.ts's CAPTION_PRESETS) instead of
-- every render always using the one hardcoded plain-white style. Captured once per project, same
-- pattern as ratio/watermark: set at submission time from the user's saved preference (see
-- src/lib/prefs.tsx), read by the worker when it actually burns captions in.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

alter table public.projects add column if not exists caption_style text not null default 'classic'
  check (caption_style in ('classic', 'bold_yellow', 'rose'));
