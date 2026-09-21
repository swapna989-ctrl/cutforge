import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, cpus, totalmem, freemem } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { downloadToFile, uploadFromFile } from "./r2.js";
import { downloadFromUrl, fetchVideoInfo, type VideoInfo } from "./ytdlp.js";
import { parseVideoUrl, PLATFORM_LABEL } from "./videoUrl.js";
import {
  detectSilences,
  getDuration,
  getVideoDimensions,
  cutSilences,
  extractAudio,
  extractPlanningAudio,
  extractClipRange,
  extractFrame,
  finalizeVideo,
  normalizeResolution,
  normalizeToTargetResolution,
  multiClipTargetDimensions,
  concatClips,
  STANDARD_LONG_EDGE,
  HD_LONG_EDGE,
} from "./ffmpeg.js";
import { wantsHdWorkingCopy, linkedDownloadMaxHeight } from "./quality.js";
import { creditsForSeconds } from "./credits.js";
import { transcribeCaptions, transcribeSegments, type CaptionChunk } from "./transcribe.js";
import { planClips } from "./clipPlanner.js";
import { detectFaceCenterFraction } from "./faceCrop.js";
import { updateJob, getProjectClips, createShorts, updateShort, chargeProjectCredits, getAvailableCredits, type ProjectRow } from "./supabase.js";
import { toUserMessage, UserFacingError, DownloadBlockedError } from "./errors.js";
import { scheduleBlockedRetry, clearBlockedRetry } from "./blockedRetry.js";

/** Bumped by hand so a deployed failure proves which code Railway is actually running. */
export const WORKER_BUILD = "2026-09-20-hd-working-copy";

const MB = 1024 * 1024;

// Mirrors the client-side check in src/lib/upload.ts — kept here too since that check reads
// duration via the browser's <video> element, which can't always read AVI/MKV metadata and lets
// those through unchecked. This is the real backstop: every job's duration is known for certain
// by this point, regardless of container or how the client-side check went.
const MIN_VIDEO_SECONDS = 5 * 60;
const MAX_VIDEO_SECONDS = 3 * 60 * 60;

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

function formatLength(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/**
 * Refuses a linked video that can't work *before* anything is downloaded -- a live stream, a clip
 * that's too short, a 6-hour VOD, or one the owner can't afford. Downloading gigabytes just to
 * find that out is the expensive way to learn it. This is only an early, advisory exit: the
 * authoritative length and credit checks still run below against the file's real, measured duration.
 */
async function checkLinkedVideo(job: ProjectRow, info: VideoInfo): Promise<void> {
  if (info.isLive) {
    throw new UserFacingError("This is a live stream that hasn't finished yet. Paste the link again once it has ended, or upload a recording.");
  }
  const seconds = info.durationSeconds;
  if (seconds == null) return;

  // A couple of seconds of slack so a video that's a hair under the limit by the site's clock
  // isn't refused here when the measured file would pass.
  if (seconds + 2 < MIN_VIDEO_SECONDS) {
    throw new UserFacingError(`This video is only ${formatLength(seconds)} long — Flovura needs at least 5 minutes of footage.`);
  }
  if (seconds - 2 > MAX_VIDEO_SECONDS) {
    throw new UserFacingError(`This video is ${formatLength(seconds)} long — Flovura can process videos up to 3 hours.`);
  }

  const needed = creditsForSeconds(seconds);
  const available = await getAvailableCredits(job.user_id);
  if (needed > available) {
    throw new UserFacingError(
      `Not enough credits — this ${Math.ceil(seconds / 60)}-minute video needs ${needed.toLocaleString("en-IN")} credits, only ${available.toLocaleString("en-IN")} available. Head to Pricing to get more credits and continue.`
    );
  }
}

export async function processJob(job: ProjectRow): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), "cutforge-"));
  const normalizedPath = join(tmpDir, "normalized.mp4");
  const trimmedPath = join(tmpDir, "trimmed.mp4");

  try {
    const clips = await getProjectClips(job.id);
    // How large the working copy is kept while it is trimmed and cut into shorts; decided once the
    // source is on disk (see quality.ts) and reused by the silence cut below so it can't undo it.
    let workingLongEdge = STANDARD_LONG_EDGE;

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
        // The link was written by the user's own browser, so it's re-validated here (the frontend
        // check is just a courtesy) and rewritten to one canonical YouTube/Twitch form -- this is
        // what stops the worker being pointed at an arbitrary address.
        const link = parseVideoUrl(job.source_url);
        if (!link.ok) throw new UserFacingError(link.message);
        const platform = PLATFORM_LABEL[link.platform];

        await updateJob(job.id, { status_message: `Checking your ${platform} link…`, progress: 3 });
        const info = await fetchVideoInfo(link.url);
        await checkLinkedVideo(job, info);
        // Until now the project's name was just the pasted address; the real title is what the
        // user recognizes on their dashboard.
        if (info.title) await updateJob(job.id, { name: info.title.slice(0, 150) });

        await updateJob(job.id, { status_message: `Downloading from ${platform}…`, progress: 5 });
        let lastReportedPercent = 0;
        let lastReportedAt = 0;
        const maxHeight = linkedDownloadMaxHeight(job.ratio, info.durationSeconds);
        await downloadFromUrl(link.url, sourcePath, (percent) => {
          const now = Date.now();
          // Progress arrives many times a second; the database only needs a heartbeat.
          if ((percent - lastReportedPercent < 5 && percent < 100) || now - lastReportedAt < 4000) return;
          lastReportedPercent = percent;
          lastReportedAt = now;
          updateJob(job.id, { status_message: `Downloading from ${platform}… ${percent}%`, progress: 5 + Math.floor(percent * 0.03) }).catch(() => {});
        }, maxHeight);

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
      const [sourceSeconds, sourceDimensions] = await Promise.all([getDuration(sourcePath), getVideoDimensions(sourcePath)]);
      workingLongEdge = wantsHdWorkingCopy(job.ratio, sourceSeconds, sourceDimensions) ? HD_LONG_EDGE : STANDARD_LONG_EDGE;
      console.log(
        `[quality] job ${job.id}: ${sourceDimensions.width}x${sourceDimensions.height}, ${Math.round(sourceSeconds)}s, ratio ${job.ratio} -> working copy capped at ${workingLongEdge}px`
      );
      await normalizeResolution(sourcePath, normalizedPath, workingLongEdge);
    }

    await updateJob(job.id, { status_message: "Detecting scene boundaries…", progress: 20 });
    const duration = await getDuration(normalizedPath);
    if (duration < MIN_VIDEO_SECONDS) {
      throw new Error(`Video is too short (${Math.round(duration)}s) — must be at least 5 minutes long.`);
    }
    if (duration > MAX_VIDEO_SECONDS) {
      throw new Error(`Video is too long (${Math.round(duration)}s) — must be under 3 hours.`);
    }

    // The real charge, for the real duration — before any of the metered Whisper/LLM calls
    // below run, so a video the owner can't actually afford fails here (cheap: just download +
    // normalize) instead of after real OpenAI usage has already been spent on it. Also decides
    // watermark for the whole project, since that's exactly this same charge's outcome (a plan or
    // paid credit buys watermark-free; a free credit doesn't) — see charge_project_credits.
    await updateJob(job.id, { status_message: "Charging credits…", progress: 22 });
    const { watermarkFree } = await chargeProjectCredits(job.id, duration);
    job.watermark = !watermarkFree;

    const silences = await detectSilences(normalizedPath);

    await updateJob(job.id, { status_message: "Removing dead air & filler pauses…", progress: 40 });
    await cutSilences(normalizedPath, silences, duration, trimmedPath, tmpDir, workingLongEdge);

    // Persisted permanently (unlike every other file in tmpDir) so a short can be re-edited later
    // — short.source_start_seconds/end_seconds are positions in THIS trimmed timeline, not the
    // raw upload, so correctly re-extracting a short's footage after this job finishes requires
    // this exact file, not a fresh normalize+cut that could land on a different result.
    const trimmedKey = `${job.user_id}/trimmed/${job.id}.mp4`;
    await uploadFromFile(trimmedPath, trimmedKey, "video/mp4");
    await updateJob(job.id, { trimmed_key: trimmedKey });

    // From here on the source is a single, clean (dead-air-trimmed) video — the AI Clip Planner
    // reasons over that ONE transcript/timeline once, rather than per-candidate, so planning
    // cost depends on the source's length, never on how many shorts eventually get rendered.
    await updateJob(job.id, { status_message: "Analyzing transcript for clip-worthy moments…", progress: 50 });
    const planningAudioPath = join(tmpDir, "planning-audio.mp3");
    await extractPlanningAudio(trimmedPath, planningAudioPath);
    const trimmedDuration = await getDuration(trimmedPath);
    // Duration and tmpDir let this split audio too long for Whisper into pieces it accepts.
    const segments = await transcribeSegments(planningAudioPath, job.caption_language, trimmedDuration, tmpDir);

    await updateJob(job.id, { status_message: "Planning clips…", progress: 55 });
    const candidates = await planClips(segments, trimmedDuration, job.clip_length);
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
        const clipCroppedPath = join(tmpDir, `short-${i}-cropped.mp4`);
        const clipAudioPath = join(tmpDir, `short-${i}-audio.mp3`);
        const clipAssPath = join(tmpDir, `short-${i}.ass`);
        const clipFinalPath = join(tmpDir, `short-${i}-final.mp4`);

        await extractClipRange(trimmedPath, candidate.startTime, candidate.endTime, clipPath);

        // Forces the user's actual chosen ratio here, regardless of which upstream branch
        // produced clipPath — confirmed against real project data that most projects never hit
        // the (rare) multi-clip branch that used to be the only place this ratio was enforced,
        // so job.ratio was silently ignored for almost every real upload. Face-aware when a face
        // is actually found (see faceCrop.ts); falls back to plain center-crop otherwise, same
        // as the previous behavior for anything that does reach this shape-forcing step.
        const target = multiClipTargetDimensions(job.ratio);
        const faceCenter = await detectFaceCenterFraction(clipPath, candidate.endTime - candidate.startTime);
        await normalizeToTargetResolution(clipPath, clipCroppedPath, target.width, target.height, faceCenter);

        // Skips the real Whisper call entirely for "none" — nothing will be burned in, so paying
        // for a transcription no render step will ever read would be pure waste.
        let captionChunks: CaptionChunk[] = [];
        if (job.caption_style !== "none") {
          await extractAudio(clipCroppedPath, clipAudioPath);
          captionChunks = await transcribeCaptions(clipAudioPath, job.caption_language, job.caption_line_count);
        }
        const clipDimensions = await getVideoDimensions(clipCroppedPath);
        await finalizeVideo(
          clipCroppedPath,
          captionChunks,
          job.caption_style,
          job.caption_font,
          job.caption_position,
          job.watermark,
          clipDimensions.width,
          clipDimensions.height,
          clipFinalPath,
          clipAssPath
        );

        const shortOutputKey = `${job.user_id}/shorts/${randomUUID()}.mp4`;
        await uploadFromFile(clipFinalPath, shortOutputKey, "video/mp4");

        // From the FINAL rendered output (captions/crop/watermark already applied), not the
        // source — this should show exactly what the user will actually see. Mobile Safari/
        // WebKit doesn't reliably self-render a <video> element's first frame from
        // preload="metadata" alone (confirmed: worked on desktop, stayed blank on phone), so the
        // frontend uses this as a real <video poster> instead of relying on that. Non-fatal —
        // a failed extraction just means no thumbnail yet, not a failed short.
        let thumbnailKey: string | null = null;
        try {
          const thumbPath = join(tmpDir, `short-${i}-thumb.jpg`);
          await extractFrame(clipFinalPath, 1, thumbPath);
          thumbnailKey = `${job.user_id}/thumbnails/${randomUUID()}.jpg`;
          await uploadFromFile(thumbPath, thumbnailKey, "image/jpeg");
        } catch (err) {
          console.error(`Thumbnail extraction failed for short ${short.id} (non-fatal):`, err);
        }

        await updateShort(short.id, { status: "ready", output_key: shortOutputKey, thumbnail_key: thumbnailKey });
        readyCount++;
      } catch (err) {
        console.error(`Short ${short.id} (project ${job.id}) failed:`, err);
        await updateShort(short.id, { status: "failed", error_message: toUserMessage(err) }).catch((updateErr) =>
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
    clearBlockedRetry(job.id);
  } catch (err) {
    // The video site refused our servers (YouTube's bot check, a rate limit). That often passes by
    // itself, so instead of failing the job it goes back in the queue and is tried again after a
    // wait (see blockedRetry.ts); only once the retries are used up does the user see the failure.
    if (err instanceof DownloadBlockedError) {
      const retry = scheduleBlockedRetry(job.id);
      if (retry) {
        const minutes = Math.round(retry.delayMs / 60_000);
        const link = job.source_url ? parseVideoUrl(job.source_url) : null;
        const site = link?.ok ? PLATFORM_LABEL[link.platform] : "The video site";
        console.error(`Job ${job.id} was blocked by the video site; retry ${retry.attempt} of ${retry.of} in ${minutes} min:`, err.message);
        await updateJob(job.id, {
          pipeline_status: "queued",
          progress: 3,
          status_message: `${site} is limiting downloads right now — trying again in about ${minutes} minutes (retry ${retry.attempt} of ${retry.of})…`,
          error_message: null,
        }).catch((updateErr) => console.error("Also failed to record the retry:", updateErr));
        return;
      }
    }
    clearBlockedRetry(job.id);

    // The env report (thread/memory diagnostics) goes to Railway's own logs, same as every other
    // failure detail here — never into error_message, which a real user reads directly off their
    // project card. It used to be appended there raw; a real user seeing
    // "...\n[env] build=... cpus=4 totalmem=1024MB..." under a failed project is exactly the kind
    // of internal-debug leak this file exists to stop.
    console.error(`Job ${job.id} failed:`, err, `[env] ${environmentReport()}`);
    await updateJob(job.id, {
      pipeline_status: "failed",
      status_message: null,
      error_message: toUserMessage(err),
    }).catch((updateErr) => console.error("Also failed to record the failure:", updateErr));
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
