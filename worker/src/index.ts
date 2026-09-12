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
import { claimNextJob } from "./supabase.js";
import { processJob, environmentReport } from "./pipeline.js";

let running = true;
process.on("SIGTERM", () => {
  console.log("Shutting down…");
  running = false;
});

async function tick(): Promise<void> {
  try {
    const job = await claimNextJob();
    if (!job) return;
    console.log(`Processing job ${job.id} (${job.name})`);
    await processJob(job);
    console.log(`Finished job ${job.id}`);
  } catch (err) {
    console.error("Poll loop error:", err);
  }
}

async function main() {
  console.log("CutForge worker started, polling every", env.POLL_INTERVAL_MS, "ms");
  console.log("[env]", environmentReport());
  while (running) {
    await tick();
    await new Promise((r) => setTimeout(r, env.POLL_INTERVAL_MS));
  }
}

main();
