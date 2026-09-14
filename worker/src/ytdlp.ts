import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

function runYtDlp(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const binaryPath = resolveBinaryPath();
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

    const proc = spawn(binaryPath, args);
    const stderrTail: string[] = [];
    proc.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (!line.trim()) continue;
        stderrTail.push(line);
        if (stderrTail.length > 25) stderrTail.shift();
      }
    });

    proc.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`yt-dlp exited with code ${code}\nstderr tail:\n${stderrTail.join("\n")}`));
    });
    proc.on("error", reject);
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
