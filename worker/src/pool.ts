import { totalmem } from "node:os";
import { env } from "./env.js";

/**
 * Runs `task` over every item, `concurrency` at a time, and resolves when all are done. `task` is
 * expected to handle its own failures (a short that fails must not stop the others), so a throw
 * here is a bug and stops the pool instead of being swallowed.
 */
export async function runPool<T>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
}

// A rough allowance per clip being rendered at once: an ffmpeg encode measured ~250 MB at 1080p, plus
// the shared Node/face-detection footprint, plus headroom. Errs towards fewer at a time -- being
// out-of-memory-killed loses the whole job, being a little slower loses nothing.
const BYTES_PER_CONCURRENT_CLIP = 1.2 * 1024 ** 3;
const MOST_AT_ONCE = 3;

/**
 * How many clips to render at once. `CLIP_CONCURRENCY` decides when set; otherwise it follows the memory
 * this container actually has. os.totalmem() reports the *host's* memory inside a container (the same
 * trap FFMPEG_THREADS documents for CPUs), so the container's own limit is used when Node can see one.
 */
export function clipConcurrency(): number {
  if (env.CLIP_CONCURRENCY) return env.CLIP_CONCURRENCY;
  const limit = process.constrainedMemory?.() ?? 0;
  const memory = limit > 0 ? Math.min(limit, totalmem()) : totalmem();
  return Math.max(1, Math.min(MOST_AT_ONCE, Math.floor(memory / BYTES_PER_CONCURRENT_CLIP)));
}
