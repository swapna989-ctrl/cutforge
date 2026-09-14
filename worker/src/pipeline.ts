import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, cpus, totalmem, freemem } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { downloadToFile, uploadFromFile } from "./r2.js";
import { downloadFromUrl } from "./ytdlp.js";
import {
  detectSilences,
  getDuration,
  getVideoDimensions,
  cutSilences,
  extractAudio,
  extractClipRange,
  finalizeVideo,
  normalizeResolution,
  normalizeToTargetResolution,
  multiClipTargetDimensions,
  concatClips,
} from "./ffmpeg.js";
import { transcribeToSrt, transcribeSegments } from "./transcribe.js";
import { planClips } from "./clipPlanner.js";
import { updateJob, getProjectClips, createShorts, updateShort, type ProjectRow } from "./supabase.js";

/** Bumped by hand so a deployed failure proves which code Railway is actually running. */
export const WORKER_BUILD = "2026-09-14-ai-clip-planner";

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
  const normalizedPath = join(tmpDir, "normalized.mp4");
  const trimmedPath = join(tmpDir, "trimmed.mp4");

  try {
    const clips = await getProjectClips(job.id);

    if (clips.length > 0) {
      // Multi-clip path: download and normalize each source clip individually (same
      // per-clip cost as the single-clip path below, just repeated in order), then
      // concatenate the normalized clips into exactly the kind of file normalizeResolution
      // itself would have produced — everything from here on is the existing pipeline,
      // completely unaware that its input came from more than one source file.
      // Every clip must land on the exact same width/height/codec/pixel format/frame rate before
      // concatClips can safely stream-copy them together — normalizeResolution alone doesn't
      // guarantee that, since it scales each source relative to its own aspect ratio, so two
      // differently-shaped clips can (and did, in testing) come out at two different sizes.
      const target = multiClipTargetDimensions(job.ratio);
      const clipPaths: string[] = [];
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const clipProgress = 10 + Math.round((i / clips.length) * 10);
        await updateJob(job.id, {
          status_message: `Downloading clip ${i + 1} of ${clips.length}…`,
          progress: clipProgress,
        });
        const clipSourcePath = join(tmpDir, `clip-${i}-source.mp4`);
        const clipNormalizedPath = join(tmpDir, `clip-${i}-normalized.mp4`);
        await downloadToFile(clip.source_key, clipSourcePath);
        await normalizeToTargetResolution(clipSourcePath, clipNormalizedPath, target.width, target.height);
        clipPaths.push(clipNormalizedPath);
      }

      await updateJob(job.id, { status_message: "Combining clips…", progress: 20 });
      await concatClips(clipPaths, normalizedPath, tmpDir);
    } else {
      const sourcePath = join(tmpDir, "source.mp4");

      if (job.source_url && !job.source_key) {
        // Link-based project: fetch the real video first, then persist it to R2 exactly like an
        // uploaded file would be (same key pattern, same bucket) — everything from here on
        // (normalize, dead-air removal, transcription, clip planning) is completely unaware
        // whether the source arrived via upload or a link.
        await updateJob(job.id, { status_message: "Downloading from link…", progress: 5 });
        await downloadFromUrl(job.source_url, sourcePath);

        await updateJob(job.id, { status_message: "Saving source…", progress: 8 });
        const sourceKey = `${job.user_id}/source/${randomUUID()}.mp4`;
        await uploadFromFile(sourcePath, sourceKey, "video/mp4");
        await updateJob(job.id, { source_key: sourceKey });
      } else {
        if (!job.source_key) throw new Error("Job has no source_key and no source_url");
        await updateJob(job.id, { status_message: "Downloading your clip…", progress: 10 });
        await downloadToFile(job.source_key, sourcePath);
      }

      // Decodes the (possibly 4K/HEVC) source exactly once and re-encodes it down to a capped
      // resolution — every step after this works off the much cheaper result, which is what
      // actually keeps memory under Railway's 1GB container limit for real phone footage.
      await updateJob(job.id, { status_message: "Preparing footage…", progress: 15 });
      await normalizeResolution(sourcePath, normalizedPath);
    }

    await updateJob(job.id, { status_message: "Detecting scene boundaries…", progress: 20 });
    const duration = await getDuration(normalizedPath);
    const silences = await detectSilences(normalizedPath);

    await updateJob(job.id, { status_message: "Removing dead air & filler pauses…", progress: 40 });
    await cutSilences(normalizedPath, silences, duration, trimmedPath, tmpDir);

    // From here on the source is a single, clean (dead-air-trimmed) video — the AI Clip Planner
    // reasons over that ONE transcript/timeline once, rather than per-candidate, so planning
    // stays a single Whisper + LLM call regardless of how many shorts eventually get rendered.
    await updateJob(job.id, { status_message: "Analyzing transcript for clip-worthy moments…", progress: 50 });
    const planningAudioPath = join(tmpDir, "planning-audio.mp3");
    await extractAudio(trimmedPath, planningAudioPath);
    const segments = await transcribeSegments(planningAudioPath);
    const trimmedDuration = await getDuration(trimmedPath);

    await updateJob(job.id, { status_message: "Planning clips…", progress: 55 });
    const candidates = await planClips(segments, trimmedDuration);
    const shorts = await createShorts(job.id, candidates);

    // Each short is rendered independently, through the same download-free steps the old
    // single-output path used (extract -> transcribe -> caption -> watermark -> upload) — one
    // short failing to render is recorded on that short and doesn't take the others down with it.
    let readyCount = 0;
    for (let i = 0; i < shorts.length; i++) {
      const short = shorts[i];
      const candidate = candidates[i];
      const renderProgress = 60 + Math.round((i / shorts.length) * 35);
      await updateJob(job.id, {
        status_message: `Rendering short ${i + 1} of ${shorts.length}…`,
        progress: renderProgress,
      });

      try {
        await updateShort(short.id, { status: "processing" });

        const clipPath = join(tmpDir, `short-${i}.mp4`);
        const clipAudioPath = join(tmpDir, `short-${i}-audio.mp3`);
        const clipSrtPath = join(tmpDir, `short-${i}.srt`);
        const clipFinalPath = join(tmpDir, `short-${i}-final.mp4`);

        await extractClipRange(trimmedPath, candidate.startTime, candidate.endTime, clipPath);
        await extractAudio(clipPath, clipAudioPath);
        await transcribeToSrt(clipAudioPath, clipSrtPath);
        const clipDimensions = await getVideoDimensions(clipPath);
        await finalizeVideo(clipPath, clipSrtPath, job.watermark, clipDimensions.width, clipDimensions.height, clipFinalPath);

        const shortOutputKey = `${job.user_id}/shorts/${randomUUID()}.mp4`;
        await uploadFromFile(clipFinalPath, shortOutputKey, "video/mp4");

        await updateShort(short.id, { status: "ready", output_key: shortOutputKey });
        readyCount++;
      } catch (err) {
        console.error(`Short ${short.id} (project ${job.id}) failed:`, err);
        const detail = err instanceof Error ? err.message : String(err);
        await updateShort(short.id, { status: "failed", error_message: detail }).catch((updateErr) =>
          console.error("Also failed to record the short's failure:", updateErr)
        );
      }
    }

    if (readyCount === 0) {
      throw new Error(`All ${shorts.length} planned shorts failed to render`);
    }

    await updateJob(job.id, {
      pipeline_status: "ready",
      progress: 100,
      status_message: `${readyCount} of ${shorts.length} shorts ready.`,
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
