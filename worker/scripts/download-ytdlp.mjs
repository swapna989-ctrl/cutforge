// Downloads yt-dlp's own standalone binary (no separate Python install required) for the
// current platform, straight from its GitHub releases — the same "-static" approach this
// project already uses for ffmpeg (ffmpeg-static/ffprobe-static), and for the same reason:
// depending on a wrapper npm package that shells out to a python3-dependent script risks the
// exact "works on my machine, silently different on Railway" class of bug this project has hit
// more than once already (missing drawtext filter, missing system fonts).
import { createWriteStream, chmodSync, existsSync, mkdirSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(__dirname, "..", "bin");

const ASSET_BY_PLATFORM = {
  win32: "yt-dlp.exe",
  linux: "yt-dlp_linux",
  darwin: "yt-dlp_macos",
};

const asset = ASSET_BY_PLATFORM[process.platform];
if (!asset) {
  // Non-fatal — don't break `npm install` on an unsupported platform; YouTube/Twitch
  // ingestion just won't work until a binary is placed at worker/bin/ manually.
  console.warn(`[download-ytdlp] No known yt-dlp standalone binary for platform "${process.platform}" — skipping.`);
  process.exit(0);
}

const outputPath = join(BIN_DIR, asset);
if (existsSync(outputPath)) {
  console.log(`[download-ytdlp] Already present at ${outputPath}, skipping.`);
  process.exit(0);
}

mkdirSync(BIN_DIR, { recursive: true });

const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
console.log(`[download-ytdlp] Downloading ${asset} from ${url} ...`);

const res = await fetch(url, { redirect: "follow" });
if (!res.ok || !res.body) {
  throw new Error(`[download-ytdlp] Failed to download yt-dlp: ${res.status} ${res.statusText}`);
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(outputPath));

if (process.platform !== "win32") {
  chmodSync(outputPath, 0o755);
}

console.log(`[download-ytdlp] Saved to ${outputPath}`);
