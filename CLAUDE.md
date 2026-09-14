@AGENTS.md

# CutForge — Project Direction

**As of 2026-09-14, CutForge's target product changed.** This section is the source of truth
for what CutForge is building toward — read it before assuming the current single-output
pipeline is the end goal.

## Target product (not yet fully built)

CutForge is becoming a full AI clipping platform, similar to Vugola (vugolaai.com):

- User pastes a YouTube/Twitch link **or** uploads a video file.
- AI automatically finds and generates **multiple** clips from one long video — not one output
  per project.
- Each generated clip gets an AI-estimated **viral score** and an AI-written hook/caption.
- A **Shorts gallery** shows all generated clips for a project.
- Per-clip caption editing with style presets.
- Direct **publishing** to TikTok/Reels/YouTube Shorts (later phase).
- **Analytics** on posted clips (later phase).

## What already exists and stays as the foundation

Not a rebuild — the target above is built *on top of* the current real pipeline, not instead
of it:
- Supabase (auth, Postgres, RLS) for accounts and project/clip data.
- Cloudflare R2 for source and output video storage.
- The Railway-hosted worker (`worker/`) running FFmpeg (dead-air removal, resolution
  normalization, multi-clip concat, caption burn-in) and OpenAI Whisper (transcription).
- The Stitch-derived warm-editorial UI (Playfair Display + Plus Jakarta Sans, rose/cream
  palette) across auth, dashboard, and workspace.
- The existing `projects` / `project_clips` schema and upload-to-R2 flow.

## What's actually missing, in build order

1. **AI Clip Planner** — an LLM step that takes a Whisper transcript and outputs 3–5 candidate
   clip timestamps + hook lines + captions as JSON. *(Next task, not yet started.)*
2. Wire the planner into the worker so **one video produces multiple clip records and multiple
   rendered outputs**, not one — this is a real change to `worker/src/pipeline.ts`'s job model,
   distinct from the existing `project_clips` table (which today holds multiple *source* clips
   merged into one output, not multiple *generated* outputs from one source).
3. YouTube/Twitch URL ingestion — download before processing, then reuse the existing
   upload-flow pipeline unchanged from that point on.
4. A real viral score — can start as a simple heuristic or LLM-estimated score; doesn't need to
   be sophisticated at first.
5. Publishing integrations (TikTok/Reels/YouTube APIs) — later, after 1–4 work.

## Current actual implementation status (do not assume otherwise)

As of this writing, the real, working pipeline still produces **one edited output per
project** (multiple *source* clips can be merged into that one output, but the system does not
yet generate multiple candidate Shorts from a single long video, has no viral score, no
YouTube/Twitch ingestion, and no publishing integrations). Treat every item in "what's actually
missing" above as unbuilt until a task explicitly implements it.
