/** An error whose message is already written for the end user and safe to show as-is -- e.g. "this
 *  video is private". toUserMessage passes these through untouched; anything else that isn't
 *  recognized still collapses to the generic message, so raw stderr can never leak by accident. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/**
 * Turns a caught error into what actually reaches projects.error_message / shorts.error_message
 * — the one thing a real user sees when a render fails. ffmpeg/yt-dlp/Whisper failures carry raw
 * stderr, shell commands, and syscall details (see ffmpeg.ts's runFfmpeg, ytdlp.ts, transcribe.ts's
 * describeError) that are genuinely useful for debugging but meaningless and alarming to a user —
 * every call site here still `console.error`s the full error first, so none of that detail is
 * lost, it just doesn't leave the server.
 */
export function toUserMessage(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;

  const raw = err instanceof Error ? err.message : String(err);

  // The one worker-thrown error with genuinely useful, safe-to-show specifics (the real minute
  // count and credit numbers) — see charge_project_credits in
  // supabase/migrations/0009_duration_scaled_credits.sql. Everything else below it collapses to
  // one honest, generic message instead of guessing at which raw text might be safe to show.
  if (raw.startsWith("INSUFFICIENT_CREDITS:")) {
    const detail = raw.slice("INSUFFICIENT_CREDITS:".length).trim();
    return `Not enough credits — ${detail}. Head to Pricing to get more credits and continue.`;
  }

  return "Something went wrong while processing this video. Please try again — if it keeps happening, contact support.";
}
