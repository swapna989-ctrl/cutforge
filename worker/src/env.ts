// Trimming isn't optional hygiene here — it's fixed two real production outages so far
// (a Supabase URL and an OpenAI key each landed with a trailing newline from a dashboard paste,
// the latter making the "Bearer <key>" auth header technically invalid and failing every
// OpenAI call with an opaque "Connection error."). Stripping whitespace can't break a value
// that was already correct, so there's no reason to ever skip it.
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// How many threads each ffmpeg encode/decode may use. 2 is what a 1 GB / 2 vCPU container needed (see
// THREAD_LIMIT in ffmpeg.ts); on a larger plan it can be raised in Railway without a code change.
// Anything that isn't a whole number from 1 to 8 falls back to 2 rather than being trusted.
function ffmpegThreads(raw: string | undefined): number {
  const n = Number(raw?.trim());
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : 2;
}

// How many short clips are cut and rendered at the same time. Unset means "work it out from the
// memory this container really has" (see pool.ts); a whole number from 1 to 6 overrides that, e.g.
// once a bigger Railway plan is in place. Anything else is ignored rather than trusted.
function parseClipConcurrency(raw: string | undefined): number | null {
  const n = Number(raw?.trim());
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
}

export const env = {
  SUPABASE_URL: required("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),
  R2_ENDPOINT: required("R2_ENDPOINT"),
  R2_ACCESS_KEY_ID: required("R2_ACCESS_KEY_ID"),
  R2_SECRET_ACCESS_KEY: required("R2_SECRET_ACCESS_KEY"),
  R2_BUCKET_NAME: required("R2_BUCKET_NAME"),
  OPENAI_API_KEY: required("OPENAI_API_KEY"),
  POLL_INTERVAL_MS: Number(process.env.POLL_INTERVAL_MS ?? 4000),
  FFMPEG_THREADS: ffmpegThreads(process.env.FFMPEG_THREADS),
  CLIP_CONCURRENCY: parseClipConcurrency(process.env.CLIP_CONCURRENCY),
  // Optional — the Netscape-format cookies.txt contents for a dedicated (throwaway, not a real
  // user's) YouTube account, used so yt-dlp looks like a logged-in browser instead of an
  // anonymous request from a datacenter IP. YouTube blocks the latter outright ("Sign in to
  // confirm you're not a bot") for cloud hosts like Railway. Absent in local dev, where that
  // block hasn't been observed against a home IP.
  YOUTUBE_COOKIES: process.env.YOUTUBE_COOKIES?.trim() || null,
  // Optional -- a proxy URL (http://user:pass@host:port) that YouTube requests are routed through.
  // Cookies alone get past YouTube's bot check for now, but cloud IPs are what it distrusts, so this
  // is the lever to pull if that stops being enough: a residential proxy makes the worker look like
  // a home connection. Used for YouTube only (Twitch works from a datacenter, and residential
  // proxies bill per gigabyte).
  YTDLP_PROXY: process.env.YTDLP_PROXY?.trim() || null,
};
