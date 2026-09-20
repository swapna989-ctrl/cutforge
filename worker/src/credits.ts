// A video burns this many credits for every started minute of its length (a 100-minute video is 1,500
// credits). Mirrors charge_project_credits() in supabase/migrations/0029_credits_per_minute.sql, which
// is what actually charges, and CREDITS_PER_MINUTE in src/lib/pricing.ts. The worker only uses this to
// refuse a linked video the owner can't afford before anything is downloaded; the database's own charge
// is the authoritative one.
export const CREDITS_PER_MINUTE = 15;

export function creditsForSeconds(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60)) * CREDITS_PER_MINUTE;
}
