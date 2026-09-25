import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir, cpus, totalmem, freemem } from "node:os";
import { join } from "node:path";
import { downloadToFile, uploadFromFile } from "./r2.js";
import { downloadAudioFromUrl, fetchVideoInfo, resolveStreams, isYouTube, type VideoInfo } from "./ytdlp.js";
import { registerStream, type RegisteredStream } from "./streamRelay.js";
import { env } from "./env.js";
import { parseVideoUrl, PLATFORM_LABEL } from "./videoUrl.js";
import {
  getDuration,
  getVideoDimensions,
  extractPlanningAudio,
  cutWorkingCopy,
  normalizeToTargetResolution,
  multiClipTargetDimensions,
  concatClips,
  STANDARD_LONG_EDGE,
  HD_LONG_EDGE,
} from "./ffmpeg.js";
import { wantsHdWorkingCopy, linkedDownloadMaxHeight } from "./quality.js";
import { creditsForSeconds } from "./credits.js";
import { transcribeSegments } from "./transcribe.js";
import { planClips } from "./clipPlanner.js";
import { renderShort, clipSourceKey, type RenderSettings } from "./render.js";
import { runPool, clipConcurrency } from "./pool.js";
import {
  updateJob,
  getProjectClips,
  createShorts,
  updateShort,
  chargeProjectCredits,
  refundProjectCredits,
  getAvailableCredits,
  type ProjectRow,
} from "./supabase.js";
import { toUserMessage, UserFacingError, DownloadBlockedError } from "./errors.js";
import { scheduleBlockedRetry, clearBlockedRetry } from "./blockedRetry.js";

/** Bumped by hand so a deployed failure proves which code Railway is actually running. */
export const WORKER_BUILD = "2026-09-22-stream-relay";

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
    `constrainedmem=${Math.round((process.constrainedMemory?.() ?? 0) / MB)}MB`,
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

/** Where each short's picture is cut from: a file on this machine, or a video site's stream, read
 *  through this worker's own relay (see streamRelay.ts) rather than by ffmpeg directly. `refresh`
 *  (link jobs only) asks the site for a brand new set of stream addresses and swaps them in --
 *  a resolved address is occasionally bad in a way retrying the SAME address can't fix (observed on a
 *  real job: ffmpeg exited 0 with a 262-byte, silent-audio file for one clip while five others from
 *  the same video cut correctly; re-running the same clip moments later worked with no code change).
 *  Mutates `streams` in place so every clip already in flight against this footage picks up the fresh
 *  addresses on its own next read, without needing to know a refresh happened. */
export type Footage =
  | { source: "local"; path: string; longEdge: number }
  | { source: "relay"; streams: RegisteredStream[]; longEdge: number; refresh: () => Promise<void> };

function footageInputs(footage: Footage): { source: string }[] {
  return footage.source === "local" ? [{ source: footage.path }] : footage.streams.map((s) => ({ source: s.url }));
}

/** ffmpeg's own wording when the relay answers a request with a plain refusal (see streamRelay.ts's
 *  403 passthrough). Used only to give the pre-charge probe a clearer message -- it does not change
 *  whether a per-clip failure is retried, see cutMoment. */
function isRefused(err: unknown): boolean {
  return err instanceof Error && /403 Forbidden/i.test(err.message);
}

/**
 * Cuts one moment out of the footage. The relay already retries a transient failure on its own
 * (streamRelay.ts), so a failure that reaches here is either a real refusal or a resolved address that
 * behaves badly in a way retrying it again won't fix -- for a link, the retry asks the site for fresh
 * addresses first (see Footage.refresh) rather than hammering the one that just failed.
 */
export async function cutMoment(footage: Footage, startSeconds: number, endSeconds: number, outputPath: string): Promise<void> {
  const attempts = footage.source === "relay" ? 2 : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await cutWorkingCopy(footageInputs(footage), startSeconds, endSeconds - startSeconds, outputPath, footage.longEdge);
      const { size } = await stat(outputPath);
      if (size < 10_000) throw new Error(`Cut clip is suspiciously small (${size} bytes)`);
      return;
    } catch (err) {
      lastError = err;
      console.error(`Cutting ${startSeconds.toFixed(1)}-${endSeconds.toFixed(1)}s failed (attempt ${attempt}/${attempts}):`, err);
      if (attempt >= attempts) break;
      if (footage.source === "relay") {
        try {
          await footage.refresh();
        } catch (refreshErr) {
          console.error("Refreshing the stream before retry failed -- giving up on this clip:", refreshErr);
          break; // the addresses that just failed are the only ones left; retrying them again won't help
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (footage.source === "relay") {
    throw new UserFacingError("We couldn't fetch this part of the video from the video site. Paste the link again to retry, or upload the file instead.");
  }
  throw lastError;
}

/**
 * Tries a video-site request directly first, and only through the configured proxy if the direct
 * attempt was blocked (YouTube's bot check, a rate limit) -- a proxy is billed per gigabyte, so it is
 * the fallback, not the default. Twitch is never retried through it: it already works from a
 * datacenter, and the proxy is priced and provisioned for YouTube's traffic alone.
 */
export async function withProxyFallback<T>(url: string, attempt: (viaProxy: boolean) => Promise<T>): Promise<{ value: T; viaProxy: boolean }> {
  try {
    return { value: await attempt(false), viaProxy: false };
  } catch (err) {
    if (err instanceof DownloadBlockedError && env.YTDLP_PROXY && isYouTube(url)) {
      console.log("[pipeline] direct request was blocked -- retrying through the configured proxy");
      return { value: await attempt(true), viaProxy: true };
    }
    throw err;
  }
}

export async function processJob(job: ProjectRow): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), "cutforge-"));
  // Any stream registered with the relay (link jobs only) -- released in the outer `finally` however
  // the job ends, so a failed job doesn't leak a registration for the life of the worker process.
  const registeredStreams: RegisteredStream[] = [];

  try {
    const clips = await getProjectClips(job.id);

    // Whatever the source, the job ends up knowing three things before any expensive step: the file
    // its transcription audio is read from, where each moment's picture will be cut from, and how
    // long the video is.
    let planningInput: string;
    let footage: Footage;
    let duration: number;

    if (clips.length > 0) {
      // Multi-clip path: download and normalize each source clip individually (same
      // per-clip cost as the single-clip path below, just repeated in order), then
      // concatenate the normalized clips into one file — everything from here on is
      // completely unaware that its input came from more than one source file.
      // Every clip must land on the exact same width/height/codec/pixel format/frame rate before
      // concatClips can safely stream-copy them together — a long-edge cap alone doesn't
      // guarantee that, since it scales each source relative to its own aspect ratio, so two
      // differently-shaped clips can (and did, in testing) come out at two different sizes.
      const target = multiClipTargetDimensions(job.ratio);
      const clipPaths: string[] = [];
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const clipProgress = 3 + Math.round((i / clips.length) * 10);
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

      await updateJob(job.id, { status_message: "Combining clips…", progress: 14 });
      const combinedPath = join(tmpDir, "combined.mp4");
      await concatClips(clipPaths, combinedPath, tmpDir);
      duration = await getDuration(combinedPath);
      planningInput = combinedPath;
      footage = { source: "local", path: combinedPath, longEdge: STANDARD_LONG_EDGE };
    } else if (job.source_url && !job.source_key) {
      // Link-based project. Only the SOUND is downloaded up front: that is all it takes to transcribe
      // the video and choose its clips, and it is a tenth of the traffic of the picture. Each chosen
      // moment's picture is then read straight out of the site's own stream (see resolveStreams and
      // cutWorkingCopy), so a 2-hour video never has to be downloaded, stored, or re-encoded whole.
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

      await updateJob(job.id, { status_message: `Downloading the audio from ${platform}…`, progress: 5 });
      const audioPath = join(tmpDir, "source-audio");
      let lastReportedPercent = 0;
      let lastReportedAt = 0;
      await withProxyFallback(link.url, (viaProxy) =>
        downloadAudioFromUrl(
          link.url,
          audioPath,
          (percent) => {
            const now = Date.now();
            // Progress arrives many times a second; the database only needs a heartbeat.
            if ((percent - lastReportedPercent < 5 && percent < 100) || now - lastReportedAt < 4000) return;
            lastReportedPercent = percent;
            lastReportedAt = now;
            updateJob(job.id, { status_message: `Downloading the audio from ${platform}… ${percent}%`, progress: 5 + Math.floor(percent * 0.07) }).catch(() => {});
          },
          viaProxy
        )
      );

      // Looked up now, before any paid step, so a site that refuses it is retried (see the catch
      // below) while nothing has been spent -- and so the picture size is known. A YouTube link asked
      // for through the proxy gets a smaller picture (see linkedDownloadMaxHeight): the audio download
      // above already proved the video watchable, so the proxy going ahead at all only ever costs a
      // gigabyte-billed video stream, never a wasted whole job.
      await updateJob(job.id, { status_message: `Preparing the ${platform} video…`, progress: 13 });
      const maxHeight = linkedDownloadMaxHeight(job.ratio);
      const { value: streams, viaProxy } = await withProxyFallback(link.url, (viaProxy) => resolveStreams(link.url, maxHeight, viaProxy));
      const hd = wantsHdWorkingCopy(job.ratio, streams.width > 0 && streams.height > 0 ? streams : undefined);
      const longEdge = hd ? HD_LONG_EDGE : STANDARD_LONG_EDGE;
      console.log(`[quality] job ${job.id}: stream ${streams.width}x${streams.height}, ratio ${job.ratio}, proxy ${viaProxy} -> working copy capped at ${longEdge}px`);

      // Addresses are bound to the IP that asked for them (YouTube), so bytes fetched for them must
      // go the same way (direct or through the same proxy) as the request that produced them.
      const proxy = viaProxy && env.YTDLP_PROXY ? env.YTDLP_PROXY : null;
      const relayStreams = await Promise.all(streams.inputs.map((s) => registerStream({ url: s.url, headers: s.headers, proxy, hls: s.hls })));
      registeredStreams.push(...relayStreams);
      const linkedFootage: Extract<Footage, { source: "relay" }> = {
        source: "relay",
        streams: relayStreams,
        longEdge,
        refresh: async () => {
          console.log(`[pipeline] job ${job.id}: re-resolving ${platform} stream addresses for a retry`);
          const fresh = await resolveStreams(link.url, maxHeight, viaProxy);
          const freshStreams = await Promise.all(fresh.inputs.map((s) => registerStream({ url: s.url, headers: s.headers, proxy, hls: s.hls })));
          registeredStreams.push(...freshStreams);
          // The old registrations are left in `registeredStreams` too and released with everything
          // else in the outer `finally` -- another clip could still be mid-cut against them right now.
          linkedFootage.streams = freshStreams;
        },
      };

      duration = await getDuration(audioPath);

      // A quick real read BEFORE any credit is charged: resolveStreams only asks the site to describe
      // its formats, which can succeed even when the actual bytes are refused (an address that expired
      // between the two requests, a block that only shows up on the real fetch). Whatever this costs
      // in traffic is refunded by catching a charge for a video that could never actually be rendered.
      const probePath = join(tmpDir, "probe.mp4");
      try {
        await cutWorkingCopy(footageInputs(linkedFootage), 0, Math.min(2, duration), probePath, 320);
      } catch (err) {
        console.error(`[pipeline] job ${job.id}: pre-charge probe of the ${platform} stream failed:`, err);
        if (isRefused(err)) throw new DownloadBlockedError(`${platform} refused this video's stream. Paste the link again to retry, or upload the file instead.`);
        throw new UserFacingError(`We couldn't read this video from ${platform}. Paste the link again to retry, or upload the file instead.`);
      }

      planningInput = audioPath;
      footage = linkedFootage;
    } else {
      if (!job.source_key) throw new Error("Job has no source_key and no source_url");
      const sourcePath = join(tmpDir, "source.mp4");
      await updateJob(job.id, { status_message: "Downloading your video…", progress: 5 });
      await downloadToFile(job.source_key, sourcePath);

      // The upload is read in place: nothing is re-encoded up front. Each chosen moment is cut out of
      // it and only that moment is decoded (see cutWorkingCopy), which is also what keeps memory low
      // for big phone footage (4K/HEVC) -- one short moment at a time, never the whole file.
      await updateJob(job.id, { status_message: "Preparing footage…", progress: 12 });
      const [sourceDuration, sourceDimensions] = await Promise.all([getDuration(sourcePath), getVideoDimensions(sourcePath)]);
      const hd = wantsHdWorkingCopy(job.ratio, sourceDimensions);
      console.log(
        `[quality] job ${job.id}: ${sourceDimensions.width}x${sourceDimensions.height}, ${Math.round(sourceDuration)}s, ratio ${job.ratio} -> working copy capped at ${hd ? HD_LONG_EDGE : STANDARD_LONG_EDGE}px`
      );
      duration = sourceDuration;
      planningInput = sourcePath;
      footage = { source: "local", path: sourcePath, longEdge: hd ? HD_LONG_EDGE : STANDARD_LONG_EDGE };
    }

    if (duration < MIN_VIDEO_SECONDS) {
      throw new Error(`Video is too short (${Math.round(duration)}s) — must be at least 5 minutes long.`);
    }
    if (duration > MAX_VIDEO_SECONDS) {
      throw new Error(`Video is too long (${Math.round(duration)}s) — must be under 3 hours.`);
    }

    // The real charge, for the real duration — before any of the metered Whisper/LLM calls
    // below run, so a video the owner can't actually afford fails here (cheap: just the audio or
    // the file) instead of after real OpenAI usage has already been spent on it. Also decides
    // watermark for the whole project, since that's exactly this same charge's outcome (a plan or
    // paid credit buys watermark-free; a free credit doesn't) — see charge_project_credits.
    await updateJob(job.id, { status_message: "Charging credits…", progress: 16 });
    const { watermarkFree } = await chargeProjectCredits(job.id, duration);
    job.watermark = !watermarkFree;

    // The transcript of the WHOLE video, read once, is what decides every clip -- planning cost
    // depends on the video's length, never on how many shorts eventually get rendered. Positions in
    // it are positions in the original video, so a short's [start - end] is where it really is.
    await updateJob(job.id, { status_message: "Transcribing the audio…", progress: 20 });
    const planningAudioPath = join(tmpDir, "planning-audio.mp3");
    await extractPlanningAudio(planningInput, planningAudioPath);
    // Duration and tmpDir let this split audio too long for Whisper into pieces it accepts.
    const segments = await transcribeSegments(planningAudioPath, job.caption_language, duration, tmpDir);

    await updateJob(job.id, { status_message: "Finding the best moments…", progress: 45 });
    const candidates = await planClips(segments, duration, job.clip_length);
    const shorts = await createShorts(job.id, candidates);

    // Each short is cut, rendered and uploaded independently, a few at a time — one failing is
    // recorded on that short and doesn't take the others down with it. Each works in its own
    // directory that is deleted the moment it finishes, so a 50-clip job never holds 50 clips' worth
    // of files on disk at once.
    const settings: RenderSettings = {
      ratio: job.ratio,
      captionStyle: job.caption_style,
      captionFont: job.caption_font,
      captionPosition: job.caption_position,
      captionLanguage: job.caption_language,
      captionLineCount: job.caption_line_count,
      watermark: job.watermark,
    };
    const concurrency = clipConcurrency();
    console.log(`[render] job ${job.id}: ${shorts.length} shorts, ${concurrency} at a time [env] ${environmentReport()}`);
    await updateJob(job.id, { status_message: `Creating your ${shorts.length} clips…`, progress: 50 });

    let readyCount = 0;
    let finishedCount = 0;
    await runPool(
      shorts.map((short, i) => ({ short, candidate: candidates[i] })),
      concurrency,
      async ({ short, candidate }, i) => {
        const workDir = await mkdtemp(join(tmpDir, `short-${i}-`));
        try {
          await updateShort(short.id, { status: "processing" });

          const sourcePath = join(workDir, "source.mp4");
          const cutStartedAt = Date.now();
          await cutMoment(footage, candidate.startTime, candidate.endTime, sourcePath);
          const cutSeconds = Math.round((Date.now() - cutStartedAt) / 1000);

          // Kept so this short can be re-edited later (see regenerate.ts): for a linked video the
          // original is never stored, and even for an upload this is far smaller to fetch back.
          // Non-fatal -- the short itself is what the user asked for.
          await uploadFromFile(sourcePath, clipSourceKey(job.user_id, short.id), "video/mp4").catch((err) =>
            console.error(`Couldn't save the editing copy of short ${short.id} (non-fatal):`, err)
          );

          const { outputKey, thumbnailKey } = await renderShort({
            sourcePath,
            workDir,
            userId: job.user_id,
            settings,
            removeDeadAir: true,
            workingLongEdge: footage.longEdge,
          });
          await updateShort(short.id, { status: "ready", output_key: outputKey, thumbnail_key: thumbnailKey });
          readyCount++;
          console.log(`[render] short ${i + 1}/${shorts.length}: cut ${cutSeconds}s, whole short ${Math.round((Date.now() - cutStartedAt) / 1000)}s`);
        } catch (err) {
          console.error(`Short ${short.id} (project ${job.id}) failed:`, err);
          await updateShort(short.id, { status: "failed", error_message: toUserMessage(err) }).catch((updateErr) =>
            console.error("Also failed to record the short's failure:", updateErr)
          );
        } finally {
          await rm(workDir, { recursive: true, force: true }).catch(() => {});
          finishedCount++;
          await updateJob(job.id, {
            status_message: `Creating your clips… ${finishedCount} of ${shorts.length} done`,
            progress: 50 + Math.round((finishedCount / shorts.length) * 45),
          }).catch(() => {});
        }
      }
    );

    if (readyCount === 0) {
      throw new Error(`All ${shorts.length} planned shorts failed to render`);
    }

    await updateJob(job.id, {
      pipeline_status: "ready",
      progress: 100,
      status_message: `${readyCount} of ${shorts.length} shorts ready.`,
    });
    if (registeredStreams.length > 0) {
      const bytes = registeredStreams.reduce((sum, s) => sum + s.bytesFetched(), 0);
      console.log(`[render] job ${job.id}: fetched ${(bytes / 1e6).toFixed(1)} MB from the video site's stream across ${shorts.length} clip(s)`);
    }
    clearBlockedRetry(job.id);
  } catch (err) {
    // The video site refused our servers (YouTube's bot check, a rate limit). That often passes by
    // itself, so instead of failing the job it goes back in the queue and is tried again after a
    // wait (see blockedRetry.ts); only once the retries are used up does the user see the failure.
    // This can only happen before any short exists (the audio download and the stream lookup), so a
    // retry never leaves duplicates behind.
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

    // A total failure delivered nothing, so the charge (see chargeProjectCredits above) shouldn't
    // stand -- refund whatever was actually taken, straight back into the same plan/paid/free
    // buckets it came from. Safe to call even when nothing was ever charged (a job that failed
    // before reaching that step, or a blocked-and-retried one): refund_project_credits recognizes
    // that and simply returns 0. Its own failure is logged, not thrown -- the user still needs to
    // see their job marked failed even if the refund itself couldn't be recorded this time.
    let refundedCredits = 0;
    try {
      refundedCredits = await refundProjectCredits(job.id);
    } catch (refundErr) {
      console.error(`Job ${job.id}: refund failed (the failure itself is still recorded):`, refundErr);
    }
    const refundNote = refundedCredits > 0 ? " Your credits for this video have been refunded." : "";

    await updateJob(job.id, {
      pipeline_status: "failed",
      status_message: null,
      error_message: toUserMessage(err) + refundNote,
    }).catch((updateErr) => console.error("Also failed to record the failure:", updateErr));
  } finally {
    for (const s of registeredStreams) s.dispose();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
