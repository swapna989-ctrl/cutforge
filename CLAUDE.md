@AGENTS.md

# CutForge — Project Direction

**As of 2026-09-14, CutForge's target product changed** from a single-output editing tool to a
full AI clipping platform, similar to Vugola (vugolaai.com). **As of 2026-09-25, most of that
target is actually built** — this file was badly out of date (it still described the planner,
multi-clip generation, and YouTube ingestion as unstarted) and has been rewritten to match the
real code. Read the "What's actually built" section below before assuming otherwise; don't trust
an older cached copy of this file over the code itself.

## Target product

- User pastes a YouTube/Twitch link **or** uploads a video file. ✅ Built.
- AI automatically finds and generates **multiple** clips from one long video — not one output
  per project. ✅ Built.
- Each generated clip gets an AI-estimated **viral score** and an AI-written hook/caption. ✅ Built.
- A **Shorts gallery** shows all generated clips for a project. ✅ Built.
- Per-clip caption/ratio/crop editing with style presets, regenerated independently of the rest
  of the project. ✅ Built.
- Direct **publishing** to TikTok/Reels/YouTube Shorts. ❌ Not built — the real remaining gap.
- **Analytics** on posted clips. ❌ Not built — depends on publishing existing first.

## What's actually built (verify against the code before describing it as missing)

- **Supabase** (auth, Postgres, RLS) for accounts, `projects`, `shorts`, and `billing`.
- **Cloudflare R2** for source video, per-short saved footage, rendered outputs, and thumbnails.
- **The Railway-hosted worker** (`worker/`, service `cutforge`) running FFmpeg (dead-air removal,
  resolution normalization, multi-clip concat, caption burn-in, per-short re-render), OpenAI
  Whisper (`whisper-1`, transcription + Hinglish transliteration), and GPT-4o-mini for both the AI
  Clip Planner and caption transcription.
- **AI Clip Planner** (`worker/src/clipPlanner.ts`): takes the Whisper transcript and a target
  clip count scaled to video length (`targetClipCount`, 3–50 clips, ~1 per 2.5 minutes of source —
  benchmarked directly against Vugola's own ~50-clips-from-128-minutes ratio), and returns
  candidate `{startTime, endTime, hook, caption, viralScore}` objects per clip. `viralScore` is an
  LLM estimate (0–100), not measured outcome data — there's no posted-clip performance signal to
  train or calibrate against yet.
- **Multi-clip generation per project**: one job produces multiple `shorts` rows and multiple
  rendered outputs, each independently re-renderable (see below) — not the single-output-per-project
  model this file used to describe. (`project_clips` is a separate, older concept: multiple *source*
  clips merged into one output, still used by the multi-source-upload path.)
- **YouTube/Twitch URL ingestion** (`worker/src/ytdlp.ts`, `videoUrl.ts`): downloads audio for
  transcription and reads picture directly from the site's own stream via a relay
  (`streamRelay.ts`) rather than downloading the whole video. Direct-first, with a residential
  proxy (DataImpulse) fallback when YouTube's bot detection blocks the direct request — see
  `worker/src/pipeline.ts`'s `withProxyFallback` and `proxyForSession`'s per-job sticky IP
  sessions (needed because YouTube's signed stream URLs are IP-locked).
- **Shorts gallery + per-clip editing** (`ShortsGallery.tsx`, `src/app/shorts/edit/page.tsx`):
  caption style/font/position/language/line-count, ratio, and a manual crop-center override, all
  per-short (inheriting the parent project's defaults when unset). Regenerating a short costs a
  flat 15 credits, refunded automatically if that specific regenerate attempt fails
  (`refund_short_regenerate_credit`) without ever touching an earlier successful regenerate's
  charge.
- **Credit system**: plan credits → paid credits → free credits draw-down order; a project's full
  charge is refunded automatically if the whole job fails (`refund_project_credits`); job claiming
  is atomic (`claimNextJob`/`claimNextShortRegenerate` in `worker/src/supabase.ts`), safe for
  multiple concurrent workers even though only one runs today.
- **The Stitch-derived warm-editorial UI** (Playfair Display + Plus Jakarta Sans, rose/cream
  palette) across auth, dashboard, and workspace.

## What's actually still missing

1. **Publishing integrations** (TikTok/Reels/YouTube Shorts APIs) — direct posting from the Shorts
   gallery. `ShortsGallery.tsx` already has a disabled "Direct publishing is coming soon" button
   as the intended hook point.
2. **Analytics** on posted clips — depends on #1 existing first (nothing is posted yet to have
   analytics about).

Treat only these two as unbuilt. Everything else in "What's actually built" above is real,
deployed, working code — confirm against the actual files cited before telling a user otherwise.
