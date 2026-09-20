// When YouTube (or any video site) refuses our servers, the block often passes by itself within
// minutes, so a link job is given a couple more tries before it fails. The wait happens in the
// queue, not in the worker: the job goes back to "queued", is skipped by the poll loop until its
// time comes, and every other user's job carries on in the meantime. Pausing the worker itself for
// minutes would stall the whole (single, sequential) worker behind one blocked link.
//
// The bookkeeping is in memory on purpose. If the worker restarts mid-wait the job is simply picked
// up again straight away with a fresh set of tries, which is harmless, and it saves a database
// column for something this short-lived.

/** How long to wait before each retry: the first try, then these. Roughly a quarter of an hour in all. */
export const RETRY_DELAYS_MS = [3 * 60_000, 10 * 60_000];

/** A job that was deleted while waiting would otherwise stay in the map forever. */
const STALE_AFTER_MS = 60 * 60_000;

type Entry = { attempts: number; notBefore: number };
const waiting = new Map<string, Entry>();

export type RetryPlan = { attempt: number; of: number; delayMs: number };

/**
 * Records that this job was blocked and says whether to try again: the plan for the next retry, or
 * null once the retries are used up (the caller then fails the job with the block's own message).
 */
export function scheduleBlockedRetry(jobId: string, now: number = Date.now()): RetryPlan | null {
  const attempts = waiting.get(jobId)?.attempts ?? 0;
  if (attempts >= RETRY_DELAYS_MS.length) {
    waiting.delete(jobId);
    return null;
  }
  const delayMs = RETRY_DELAYS_MS[attempts];
  waiting.set(jobId, { attempts: attempts + 1, notBefore: now + delayMs });
  return { attempt: attempts + 1, of: RETRY_DELAYS_MS.length, delayMs };
}

/** Jobs the poll loop must not pick up yet because their retry time hasn't come. */
export function jobsStillWaiting(now: number = Date.now()): string[] {
  const ids: string[] = [];
  for (const [id, entry] of waiting) {
    if (now - entry.notBefore > STALE_AFTER_MS) waiting.delete(id);
    else if (entry.notBefore > now) ids.push(id);
  }
  return ids;
}

/** The job finished (or failed for good), so its retry count no longer matters. */
export function clearBlockedRetry(jobId: string): void {
  waiting.delete(jobId);
}
