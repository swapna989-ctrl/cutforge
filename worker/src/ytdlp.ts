import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";

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
    cookiesFilePathPromise = writeFile(path, env.YOUTUBE_COOKIES, "utf-8").then(() => path);
  }
  return cookiesFilePathPromise;
}

// Generous enough for a real slow-but-working download (the first request for a given video can
// take several minutes — YouTube's own extraction/anti-bot overhead, confirmed against a real
// video: ~90s+ cold, ~16s once yt-dlp's cache is warm) while still bounding the worst case. This
// worker processes one job at a time, so a download that hangs for real (network stall, an
// interactive prompt yt-dlp is silently waiting on) would otherwise block it forever.
const DOWNLOAD_TIMEOUT_MS = 8 * 60 * 1000;

async function runYtDlp(url: string, outputPath: string): Promise<void> {
  const binaryPath = resolveBinaryPath();
  const cookiesPath = await resolveCookiesFilePath();

  const args = [
    url,
    "-f",
    // Modern YouTube extraction without a JS runtime (signature deciphering) only exposes
    // separate video-only/audio-only streams — confirmed against a real download, where a
    // combined-stream selector like "best[ext=mp4]" failed outright with "Requested format
    // is not available". bestvideo+bestaudio asks yt-dlp to fetch both and mux them (via the
    // bundled ffmpeg below) into one file, which works regardless of whether a combined
    // stream exists. Capped at 1080p since everything downstream re-encodes down to 1280 on
    // the long edge anyway (see ffmpeg.ts's SCALE_FILTER) — fetching more just wastes bandwidth.
    "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    "--merge-output-format",
    "mp4",
    "--ffmpeg-location",
    ffmpegPath as string,
    "--no-playlist",
    "-o",
    outputPath,
  ];
  // Makes requests look like a logged-in browser session instead of an anonymous request from a
  // datacenter IP — without this, YouTube outright refuses cloud hosts with "Sign in to confirm
  // you're not a bot" (confirmed against Railway). Only added when configured; local dev against
  // a home IP hasn't needed it.
  if (cookiesPath) args.push("--cookies", cookiesPath);

  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, args, { timeout: DOWNLOAD_TIMEOUT_MS, killSignal: "SIGKILL" });
    const stderrTail: string[] = [];
    proc.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (!line.trim()) continue;
        stderrTail.push(line);
        if (stderrTail.length > 25) stderrTail.shift();
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
 * Downloads a video from a YouTube/Twitch (or any other yt-dlp-supported) URL to a local file.
 * Uses the standalone yt-dlp binary fetched at install time (see scripts/download-ytdlp.mjs) —
 * no Python dependency, the same "-static" approach this project already uses for ffmpeg.
 */
export async function downloadFromUrl(url: string, outputPath: string): Promise<void> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await runYtDlp(url, outputPath);

      // yt-dlp exiting 0 doesn't guarantee a real, complete file landed (seen with geo-restricted
      // or partially-available sources) — check for real bytes rather than trusting exit code alone.
      const { size } = await stat(outputPath);
      if (size < 10_000) {
        throw new Error(`Downloaded file is suspiciously small (${size} bytes) — likely an incomplete or failed download`);
      }

      return;
    } catch (err) {
      lastError = err;
      console.error(`yt-dlp download attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err instanceof Error ? err.message : err);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }

  throw new Error(
    `Failed to download ${url} after ${MAX_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}
