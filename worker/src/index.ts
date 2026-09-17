// Loads worker/.env into process.env for local runs. On Railway, env vars are injected
// directly by the platform and there's no .env file — dotenv finds nothing and no-ops.
import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";

// Railway services have outbound IPv6 disabled by default, but Node resolves addresses in
// whatever order the resolver returns them — so a host with AAAA records can have every
// connection attempt start on an unroutable IPv6 address. Preferring IPv4 removes that
// failure mode for every outbound call (OpenAI, Supabase, R2) rather than one at a time.
setDefaultResultOrder("ipv4first");
import { env } from "./env.js";
import { claimNextJob, claimNextShortRegenerate, claimNextPreviewFrame } from "./supabase.js";
import { processJob, environmentReport } from "./pipeline.js";
import { regenerateShort, extractPreviewFrame } from "./regenerate.js";

let running = true;
process.on("SIGTERM", () => {
  console.log("Shutting down…");
  running = false;
});

// One thing at a time, same as before — a full project job, a short regenerate, and a preview
// frame extraction all share this single sequential loop (see claimNextJob's own "fine for a
// single-worker v1" comment). Project jobs are checked first since they're the original, highest-
// volume path; a big job in flight simply makes a queued regenerate/preview wait its turn, same
// accepted limitation as everything else in this single-worker design.
async function tick(): Promise<void> {
  try {
    const job = await claimNextJob();
    if (job) {
      console.log(`Processing job ${job.id} (${job.name})`);
      await processJob(job);
      console.log(`Finished job ${job.id}`);
      return;
    }

    const regen = await claimNextShortRegenerate();
    if (regen) {
      console.log(`Regenerating short ${regen.id}`);
      await regenerateShort(regen);
      console.log(`Finished regenerating short ${regen.id}`);
      return;
    }

    const preview = await claimNextPreviewFrame();
    if (preview) {
      console.log(`Extracting preview frame for short ${preview.id}`);
      await extractPreviewFrame(preview);
      console.log(`Finished preview frame for short ${preview.id}`);
    }
  } catch (err) {
    console.error("Poll loop error:", err);
  }
}

async function main() {
  console.log("Flovura worker started, polling every", env.POLL_INTERVAL_MS, "ms");
  console.log("[env]", environmentReport());
  while (running) {
    await tick();
    await new Promise((r) => setTimeout(r, env.POLL_INTERVAL_MS));
  }
}

main();
