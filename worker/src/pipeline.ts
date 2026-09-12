import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, cpus, totalmem, freemem } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { downloadToFile, uploadFromFile } from "./r2.js";
import { detectSilences, getDuration, cutSilences, extractAudio, finalizeVideo, normalizeResolution } from "./ffmpeg.js";
import { transcribeToSrt } from "./transcribe.js";
import { updateJob, type ProjectRow } from "./supabase.js";

/** Bumped by hand so a deployed failure proves which code Railway is actually running. */
export const WORKER_BUILD = "2026-09-12-transcribe-retry";

const MB = 1024 * 1024;

/**
 * What the *container* reports about itself. A container that reports the host's CPU count
 * rather than its own quota makes ffmpeg auto-size thread pools (and their per-thread frame
 * buffers) far past its real memory allowance, so these numbers are the difference between
 * diagnosing an OOM and guessing at one.
 */
export function environmentReport(): string {
  return [
    `build=${WORKER_BUILD}`,
    `cpus=${cpus().length}`,
    `totalmem=${Math.round(totalmem() / MB)}MB`,
    `freemem=${Math.round(freemem() / MB)}MB`,
    `noderss=${Math.round(process.memoryUsage().rss / MB)}MB`,
  ].join(" ");
}

export async function processJob(job: ProjectRow): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), "cutforge-"));
  const sourcePath = join(tmpDir, "source.mp4");
  const normalizedPath = join(tmpDir, "normalized.mp4");
  const trimmedPath = join(tmpDir, "trimmed.mp4");
  const audioPath = join(tmpDir, "audio.mp3");
  const srtPath = join(tmpDir, "captions.srt");
  const finalPath = join(tmpDir, "final.mp4");

  try {
    if (!job.source_key) throw new Error("Job has no source_key");

    await updateJob(job.id, { status_message: "Downloading your clip…", progress: 10 });
    await downloadToFile(job.source_key, sourcePath);

    // Decodes the (possibly 4K/HEVC) source exactly once and re-encodes it down to a capped
    // resolution — every step after this works off the much cheaper result, which is what
    // actually keeps memory under Railway's 1GB container limit for real phone footage.
    await updateJob(job.id, { status_message: "Preparing footage…", progress: 15 });
    await normalizeResolution(sourcePath, normalizedPath);

    await updateJob(job.id, { status_message: "Detecting scene boundaries…", progress: 20 });
    const duration = await getDuration(normalizedPath);
    const silences = await detectSilences(normalizedPath);

    await updateJob(job.id, { status_message: "Removing dead air & filler pauses…", progress: 40 });
    await cutSilences(normalizedPath, silences, duration, trimmedPath, tmpDir);

    await updateJob(job.id, { status_message: "Transcribing audio…", progress: 60 });
    await extractAudio(trimmedPath, audioPath);
    await transcribeToSrt(audioPath, srtPath);

    await updateJob(job.id, { status_message: "Generating captions…", progress: 80 });
    await finalizeVideo(trimmedPath, srtPath, job.watermark, finalPath);

    await updateJob(job.id, { status_message: "Uploading your master…", progress: 95 });
    const outputKey = `${job.user_id}/output/${randomUUID()}.mp4`;
    await uploadFromFile(finalPath, outputKey, "video/mp4");

    await updateJob(job.id, {
      pipeline_status: "ready",
      progress: 100,
      output_key: outputKey,
      status_message: "Master ready.",
    });
  } catch (err) {
    console.error(`Job ${job.id} failed:`, err);
    const detail = err instanceof Error ? err.message : String(err);
    await updateJob(job.id, {
      pipeline_status: "failed",
      status_message: null,
      error_message: `${detail}\n[env] ${environmentReport()}`,
    }).catch((updateErr) => console.error("Also failed to record the failure:", updateErr));
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
