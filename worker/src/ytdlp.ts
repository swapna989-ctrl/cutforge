import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";
import { DownloadBlockedError, UserFacingError } from "./errors.js";

const ASSET_BY_PLATFORM: Record<string, string> = {
  win32: "yt-dlp.exe",
  linux: "yt-dlp_linux",
  darwin: "yt-dlp_macos",
};

const BIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "bin");

function resolveBinaryPath(): string {
  const asset = ASSET_BY_PLATFORM[process.platform];
  if (!asset) throw new Error(`No yt-dlp binary available for platform "${process.platform}"`);
  return join(BIN_DIR, asset);
}

// Written once per process and reused — the cookies don't change between jobs, so there's no
// reason to re-write the file on every download. `--cookies-from-browser` (yt-dlp's other cookie
// option) needs an actual browser profile on disk, which a headless server doesn't have; a
// Netscape-format file is the only option that works here.
let cookiesFilePathPromise: Promise<string | null> | null = null;

function resolveCookiesFilePath(): Promise<string | null> {
  if (!env.YOUTUBE_COOKIES) return Promise.resolve(null);
  if (!cookiesFilePathPromise) {
    const path = join(tmpdir(), "cutforge-youtube-cookies.txt");
    cookiesFilePathPromise = writeFile(path, env.YOUTUBE_COOKIES, "utf-8").then(() => {
      // Byte count only, never the contents — enough to catch "the env var is empty/truncated"
      // without logging session cookies anywhere.
      console.log(`[ytdlp] wrote cookies file: ${env.YOUTUBE_COOKIES?.length ?? 0} chars`);
      return path;
    });
  }
  return cookiesFilePathPromise;
}

// Everything downstream re-encodes to a 30fps file at a capped size (see ffmpeg.ts's scaleFilter and
// MEMORY_SAFE_X264), so a picture bigger than that cap is pure waste -- measured on a real 10-minute
// video: normalizing the 1080p60 AV1 download YouTube's default pick gave took 723s, and Twitch's default
// "Source" stream is 3x the bytes of its 720p one. Most videos are capped at 720p; a wide video that
// becomes a vertical short is capped at 1080p instead (see quality.ts), which is passed in as
// `maxHeight`. Sort keys are priority order: resolution first (closest to the cap without going over),
// then frame rate (30 if there's a choice, but never trading resolution away for it), then H.264
// (cheapest to decode) and AAC audio. `bv+ba` is separate video+audio streams (YouTube); `b` is a
// single combined stream (Twitch, which has no video-only formats, falls through to it).
function formatArgs(maxHeight: number): string[] {
  return ["-f", "bv+ba/b", "-S", `res:${maxHeight},fps:30,vcodec:h264,acodec:aac`];
}

// Generous enough for a real slow-but-working download (the first request for a given video can
// take several minutes — YouTube's own extraction/anti-bot overhead, confirmed against a real
// video: ~90s+ cold, ~16s once yt-dlp's cache is warm) while still bounding the worst case. This
// worker processes one job at a time, so a download that hangs for real (network stall, an
// interactive prompt yt-dlp is silently waiting on) would otherwise block it forever.
const DOWNLOAD_TIMEOUT_MS = 8 * 60 * 1000;
const INFO_TIMEOUT_MS = 90 * 1000;

function isYouTube(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "youtube.com" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

/** Flags every yt-dlp call shares. */
async function commonArgs(url: string): Promise<string[]> {
  const cookiesPath = await resolveCookiesFilePath();
  // Real diagnostic, not a guess — every past failure required inferring whether cookies were
  // even in play from indirect evidence (which error message came back). This says so directly.
  console.log(cookiesPath ? `[ytdlp] using cookies file at ${cookiesPath}` : "[ytdlp] YOUTUBE_COOKIES not configured — no cookies file");

  const args = [
    "--no-playlist",
    // YouTube now needs a JavaScript runtime to solve its signature/throttling challenges; without
    // one yt-dlp warns "extraction ... has been deprecated, and some formats may be missing".
    // This worker is a Node process, so point yt-dlp at that same Node binary instead of relying on
    // it being findable on PATH.
    "--js-runtimes",
    `node:${process.execPath}`,
    "--socket-timeout",
    "30",
    "--retries",
    "5",
  ];
  // Makes requests look like a logged-in browser session instead of an anonymous request from a
  // datacenter IP — without this, YouTube outright refuses cloud hosts with "Sign in to confirm
  // you're not a bot" (confirmed against Railway). Only added when configured; local dev against
  // a home IP hasn't needed it.
  if (cookiesPath) args.push("--cookies", cookiesPath);

  if (env.YTDLP_PROXY && isYouTube(url)) {
    args.push("--proxy", env.YTDLP_PROXY);
    // Host and port only -- the proxy URL carries a username and password.
    let where = "configured proxy";
    try {
      where = new URL(env.YTDLP_PROXY).host;
    } catch {
      // Malformed value: yt-dlp will report it; nothing here should ever echo the raw string.
    }
    console.log(`[ytdlp] routing this YouTube request through proxy ${where}`);
  }
  return args;
}

type Captured = { stdout: string; stderr: string; code: number | null; timedOut: boolean };

function runCapture(args: string[], timeoutMs: number): Promise<Captured> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveBinaryPath(), args, { killSignal: "SIGKILL" });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);
    proc.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
  });
}

/** `blocked` is a permanent failure *for this attempt* that is likely to pass on its own later (the
 *  site refusing our servers), so the pipeline retries the whole job after a wait instead of
 *  failing it. */
type Failure = { message: string; permanent: boolean; blocked?: boolean };

const permanent = (message: string): Failure => ({ message, permanent: true });
const blocked = (message: string): Failure => ({ message, permanent: true, blocked: true });

function failureToError(failure: Failure): UserFacingError {
  return failure.blocked ? new DownloadBlockedError(failure.message) : new UserFacingError(failure.message);
}

/**
 * Turns yt-dlp's raw stderr into something a user can act on, and says whether retrying could
 * possibly help. Matched on the wording yt-dlp/YouTube/Twitch actually use; anything not
 * recognized returns null and gets the generic message (never the raw text -- see errors.ts).
 */
export function explainYtDlpFailure(stderr: string): Failure | null {
  const s = stderr.toLowerCase();

  if (s.includes("private video") || s.includes("video is private")) {
    return permanent("This video is private, so Flovura can't download it. Make it public or unlisted and try again, or upload the file.");
  }
  if (s.includes("members-only") || s.includes("members only") || s.includes("join this channel")) {
    return permanent("This video is for channel members only, so Flovura can't download it. Upload the file instead.");
  }
  if (s.includes("subscriber") && s.includes("only")) {
    return permanent("This broadcast is for subscribers only, so Flovura can't download it. Upload the file instead.");
  }
  if (s.includes("confirm your age") || s.includes("age-restricted") || s.includes("age restricted") || s.includes("inappropriate for some users")) {
    return permanent("This video is age-restricted, so Flovura can't download it. Upload the file instead.");
  }
  if (s.includes("available in your country") || s.includes("blocked it in your country") || s.includes("blocked in your country")) {
    return permanent("This video isn't available in the region our servers run in. Upload the file instead.");
  }
  if (s.includes("premieres in") || s.includes("live event will begin") || s.includes("this live event")) {
    return permanent("This is a live event that hasn't finished yet. Paste the link again once it has ended, or upload a recording.");
  }
  if (
    s.includes("video unavailable") ||
    s.includes("has been removed") ||
    s.includes("no longer available") ||
    s.includes("content is unavailable") ||
    s.includes("does not exist") ||
    s.includes("http error 404")
  ) {
    return permanent("That video is unavailable — it may have been removed or made private. Check the link, or upload the file.");
  }
  if (s.includes("not a bot") || s.includes("sign in to confirm")) {
    // Not the user's problem. Sometimes it passes on its own (the job is retried later), sometimes
    // the cookies expired or this server's IP got flagged for a while. Say so in the logs where
    // someone can act on it.
    console.error("[ytdlp] YouTube bot check hit — the YOUTUBE_COOKIES may be expired or this IP is flagged. Refresh the cookies if it keeps happening.");
    return blocked("YouTube is blocking automatic downloads from our servers for this video right now. Try again later, or download it yourself and upload the file.");
  }
  if (s.includes("http error 429") || s.includes("too many requests")) {
    console.error("[ytdlp] the site is rate-limiting this server (HTTP 429).");
    return blocked("The video site is limiting automatic downloads from our servers right now. Try again in a few minutes, or download it yourself and upload the file.");
  }
  return null;
}

// What one full attempt costs us if it fails for a reason a newer yt-dlp might fix: YouTube changes
// its player every few weeks and old yt-dlp builds stop extracting.
function looksLikeStaleYtDlp(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    s.includes("unable to extract") ||
    s.includes("requested format is not available") ||
    s.includes("nsig") ||
    s.includes("signature") ||
    s.includes("http error 403") ||
    s.includes("please report this issue")
  );
}

const GENERIC_DOWNLOAD_FAILURE = "We couldn't download that video. Check that the link opens in your browser, or upload the file instead.";

export type VideoInfo = { title: string | null; durationSeconds: number | null; isLive: boolean };

/**
 * Asks yt-dlp what a link is (title, length, live or not) without downloading anything -- so a
 * private video, a live stream, a 12-hour VOD, or one the owner can't afford is refused in
 * seconds instead of after downloading gigabytes.
 */
export async function fetchVideoInfo(url: string): Promise<VideoInfo> {
  const result = await runCapture(
    [url, "--skip-download", "--print", "%(.{title,duration,is_live,live_status})j", ...(await commonArgs(url))],
    INFO_TIMEOUT_MS
  );

  if (result.code !== 0) {
    console.error(`[ytdlp] info lookup failed (code ${result.code}${result.timedOut ? ", timed out" : ""}):`, result.stderr.trim().split("\n").slice(-6).join(" | "));
    const known = explainYtDlpFailure(result.stderr);
    if (known) throw failureToError(known);
    throw new UserFacingError(GENERIC_DOWNLOAD_FAILURE);
  }

  const line = result.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  try {
    const parsed = JSON.parse(line) as { title?: string; duration?: number; is_live?: boolean; live_status?: string };
    const live = parsed.is_live === true || parsed.live_status === "is_live" || parsed.live_status === "is_upcoming" || parsed.live_status === "post_live";
    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : null,
      durationSeconds: typeof parsed.duration === "number" ? parsed.duration : null,
      isLive: live,
    };
  } catch {
    // Unreadable output shouldn't block a download that would otherwise work -- just skip the
    // up-front checks; the pipeline still enforces length and credits once the file is real.
    console.error("[ytdlp] couldn't parse info output:", line.slice(0, 200));
    return { title: null, durationSeconds: null, isLive: false };
  }
}

/** Best-effort update of the standalone yt-dlp binary to the latest release. Non-fatal by design:
 *  a failed update just means we keep running the version we already have. */
export async function updateYtDlp(): Promise<void> {
  try {
    const result = await runCapture(["-U"], 2 * 60 * 1000);
    const summary = (result.stdout + result.stderr).trim().split("\n").filter(Boolean).slice(-2).join(" | ");
    console.log(`[ytdlp] update check: ${summary || `exit ${result.code}`}`);
  } catch (err) {
    console.error("[ytdlp] update check failed (continuing with the current version):", err instanceof Error ? err.message : err);
  }
}

export async function logYtDlpVersion(): Promise<void> {
  try {
    const result = await runCapture(["--version"], 15_000);
    console.log(`[ytdlp] version ${result.stdout.trim()}`);
  } catch (err) {
    console.error("[ytdlp] couldn't read version:", err instanceof Error ? err.message : err);
  }
}

async function runYtDlp(url: string, outputPath: string, maxHeight: number, onProgress?: (percent: number) => void): Promise<void> {
  const args = [
    url,
    ...formatArgs(maxHeight),
    "--merge-output-format",
    "mp4",
    "--ffmpeg-location",
    ffmpegPath as string,
    // One progress line per update instead of carriage-return overwrites, so it can be parsed --
    // and so stdout is actually consumed below (an unread pipe that fills up stalls the process).
    "--newline",
    // Twitch VODs and YouTube's segmented streams download in fragments; fetching a few at once
    // is the difference between minutes and tens of minutes for a long recording.
    "--concurrent-fragments",
    "4",
    "--fragment-retries",
    "10",
    "-o",
    outputPath,
    ...(await commonArgs(url)),
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(resolveBinaryPath(), args, { timeout: DOWNLOAD_TIMEOUT_MS, killSignal: "SIGKILL" });
    const stderrTail: string[] = [];
    let bestPercent = 0;

    proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (!m) continue;
        // Video and audio download as separate streams, so the percentage restarts at 0 for the
        // second one; only ever move forward so the reported progress never jumps backward.
        const percent = Math.min(100, Math.floor(Number(m[1])));
        if (percent > bestPercent) {
          bestPercent = percent;
          onProgress?.(percent);
        }
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (!line.trim()) continue;
        stderrTail.push(line);
        if (stderrTail.length > 60) stderrTail.shift();
      }
    });

    let timedOut = false;
    proc.on("close", (code, signal) => {
      if (code === 0) return resolve();
      if (signal === "SIGKILL" && timedOut) {
        return reject(new Error(`yt-dlp timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s\nstderr tail:\n${stderrTail.join("\n")}`));
      }
      reject(new Error(`yt-dlp exited with code ${code}\nstderr tail:\n${stderrTail.join("\n")}`));
    });
    proc.on("error", reject);

    // Node's own `timeout` option (set above) sends killSignal after the deadline but reports it
    // to `close` as a plain signal — this flag is what turns that into a distinguishable, clearly
    // labeled timeout error instead of an opaque "exited with code null".
    setTimeout(() => {
      timedOut = true;
    }, DOWNLOAD_TIMEOUT_MS).unref();
  });
}

/**
 * Downloads a video from a (pre-validated -- see videoUrl.ts) YouTube/Twitch URL to a local file.
 * Uses the standalone yt-dlp binary fetched at install time (see scripts/download-ytdlp.mjs) —
 * no Python dependency, the same "-static" approach this project already uses for ffmpeg.
 *
 * Throws UserFacingError for anything a user can act on (private/removed/blocked); a failure it
 * can't explain becomes the generic download message, with the real detail in the logs.
 */
export async function downloadFromUrl(
  url: string,
  outputPath: string,
  onProgress?: (percent: number) => void,
  /** The tallest picture to fetch; 720 unless the caller says the job will use a bigger one. */
  maxHeight: number = 720
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  let updatedYtDlp = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await runYtDlp(url, outputPath, maxHeight, onProgress);

      // yt-dlp exiting 0 doesn't guarantee a real, complete file landed (seen with geo-restricted
      // or partially-available sources) — check for real bytes rather than trusting exit code alone.
      const { size } = await stat(outputPath);
      if (size < 10_000) {
        throw new Error(`Downloaded file is suspiciously small (${size} bytes) — likely an incomplete or failed download`);
      }

      return;
    } catch (err) {
      lastError = err;
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`yt-dlp download attempt ${attempt}/${MAX_ATTEMPTS} failed:`, detail);

      const known = explainYtDlpFailure(detail);
      if (known?.permanent) throw failureToError(known);

      // A player change on YouTube's side breaks old yt-dlp builds; one update-and-retry is cheap
      // and is what actually fixes that class of failure.
      if (!updatedYtDlp && looksLikeStaleYtDlp(detail)) {
        updatedYtDlp = true;
        console.log("[ytdlp] failure looks like an outdated yt-dlp — updating before retrying");
        await updateYtDlp();
        continue;
      }

      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }

  console.error(`Failed to download ${url} after ${MAX_ATTEMPTS} attempts:`, lastError instanceof Error ? lastError.message : String(lastError));
  throw new UserFacingError(GENERIC_DOWNLOAD_FAILURE);
}
