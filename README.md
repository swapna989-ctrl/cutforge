# CutForge

An autonomous video-editing workflow prototype (Next.js App Router + Tailwind v4). The ingest/synthesize/export pipeline, dashboard project list, billing/credits, and export preferences are all mocked (browser-local state) — only auth is backed by a real Supabase project.

## Setup

Requires a Supabase project. Copy `.env.local.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=       # Project Settings → API → Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # Project Settings → API → anon public / publishable key
```

Without these, every page fails at the proxy layer with a clear "project's URL and Key are required" error rather than failing silently.

Google sign-in is wired through Supabase's own Google provider (Authentication → Providers → Google in the Supabase dashboard) — it needs your own Google Cloud OAuth client with the Supabase-provided callback URL registered as an authorized redirect URI.

Then:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Fonts

Uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) with Plus Jakarta Sans (display), Inter (body), and JetBrains Mono.

## Deploy

Standard Next.js deployment — see the [Next.js deployment docs](https://nextjs.org/docs/app/building-your-application/deploying). Remember to set the two `NEXT_PUBLIC_SUPABASE_*` env vars in whatever platform you deploy to.
