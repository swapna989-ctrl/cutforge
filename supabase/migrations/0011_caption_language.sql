-- Opt-in bias toward Romanized Hindi ("Hinglish") transcription instead of Whisper's default
-- native-script output (Devanagari for Hindi speech) — see worker/src/transcribe.ts's
-- HINGLISH_PROMPT_HINT for how this is actually applied. Opt-in, not global, since it's a
-- best-effort nudge (not a guarantee) and should never change behavior for anyone not asking
-- for it. Captured once per project, same pattern as ratio/caption_style/watermark.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

alter table public.projects add column if not exists caption_language text not null default 'auto'
  check (caption_language in ('auto', 'hinglish'));
