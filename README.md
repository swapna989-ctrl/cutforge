# CutForge

CutForge is becoming an AI clipping platform (in the spirit of Vugola/vugolaai.com): paste a
long video link or upload a file, and AI finds and generates multiple ready-to-post Shorts —
each with a viral score, hook, and captions. See `CLAUDE.md` for the full target feature set and
build order; this README covers what's real and running today.

## What's real today

- **Auth, database, billing** — Supabase (Postgres + Auth + RLS), real free/paid export credits.
- **Storage** — Cloudflare R2 for uploaded source video and rendered output.
- **Processing** — a Railway-hosted worker (`worker/`) running FFmpeg (dead-air removal,
  resolution normalization, multi-source-clip concatenation, caption burn-in) and OpenAI
  Whisper (word-level transcription, chunked into short synced caption bursts).
- **Pipeline today**: one project → one or more *source* clips merged in order → one edited
  output, with captions burned in and a watermark on free-tier exports. This is the foundation
  the AI-clipping features (multiple *generated* Shorts per project, viral scores, YouTube/Twitch
  ingestion, publishing) are being built on top of — those features are not implemented yet.

## Setup

Requires a Supabase project, a Cloudflare R2 bucket, and an OpenAI API key (for the worker).

Frontend — copy `.env.local.example` to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=       # Project Settings → API → Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # Project Settings → API → anon public / publishable key
```

Google sign-in is wired through Supabase's own Google provider (Authentication → Providers →
Google in the Supabase dashboard) — it needs your own Google Cloud OAuth client with the
Supabase-provided callback URL registered as an authorized redirect URI.

Database schema: run the migrations in `supabase/migrations/` in order, in the Supabase
dashboard's SQL Editor (they're not applied automatically).

Worker — copy `worker/.env.example` to `worker/.env`:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=      # Project Settings → API → service_role key (bypasses RLS — server-only)
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
OPENAI_API_KEY=
```

Then:

```bash
npm install
npm run dev
```

```bash
cd worker
npm install
npm run dev   # polls Supabase for queued jobs and processes them
```

Open [http://localhost:3000](http://localhost:3000). Without a worker running (locally or on
Railway), uploaded projects will sit at "queued" and never finish processing.

## Fonts

Plus Jakarta Sans (display) + Inter (body) + JetBrains Mono site-wide via `next/font`; the
auth/dashboard/workspace redesign additionally loads Playfair Display for editorial headlines,
scoped to those components only.

## Deploy

Frontend: standard Next.js deployment — see the
[Next.js deployment docs](https://nextjs.org/docs/app/building-your-application/deploying). Set
the two `NEXT_PUBLIC_SUPABASE_*` env vars in whatever platform you deploy to.

Worker: deploy `worker/` to Railway (or any Node host) with the env vars above set; it runs as a
long-lived polling process, not a serverless function.
