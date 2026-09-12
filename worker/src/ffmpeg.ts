import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath?.path) ffmpeg.setFfprobePath(ffprobePath.path);

export type SilenceInterval = { start: number; end: number };

// Caps the long edge at 1080p-equivalent before any re-encode. Source phones routinely shoot
// 4K, which needs ~4x the decode/encode memory of 1080p and was OOM-killing the worker on
// Railway's free-tier RAM for clips as short as 13s — social exports don't need 4K anyway.
// `-2` keeps the other edge's aspect ratio while forcing it even, which libx264 requires.
const SCALE_FILTER = "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'";

/** Runs ffmpeg's silencedetect filter and parses the silence_start/silence_end pairs from stderr. */
export function detectSilences(inputPath: string, noiseDb = -30, minDurationSec = 0.6): Promise<SilenceInterval[]> {
  return new Promise((resolve, reject) => {
    // -vn: silencedetect only needs the audio stream, and decoding video we're about to
    // discard anyway wastes real memory/CPU on a large source.
    const args = ["-i", inputPath, "-vn", "-af", `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`, "-f", "null", "-"];
    const proc = spawn(ffmpegPath as string, args);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("close", () => {
      const starts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
      const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
      const intervals: SilenceInterval[] = [];
      for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
        intervals.push({ start: starts[i], end: ends[i] });
      }
      resolve(intervals);
    });
    proc.on("error", reject);
  });
}

export function getDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration ?? 0);
    });
  });
}

/**
 * Cuts out silences longer than the detection threshold (keeping a small pad around each cut
 * so it doesn't feel jarring) by extracting the "keep" segments and concatenating them.
 * `-ss`/`-t` with stream copy seeks to the nearest keyframe, which is imprecise — re-encoding
 * each segment gives frame-accurate cuts, then the concat itself can stream-copy since all
 * segments now share identical codec parameters.
 */
export async function cutSilences(
  inputPath: string,
  silences: SilenceInterval[],
  duration: number,
  outputPath: string,
  tmpDir: string
): Promise<void> {
  const PAD = 0.15;
  const keep: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const s of silences) {
    const cutStart = Math.max(cursor, s.start + PAD);
    const cutEnd = Math.min(duration, s.end - PAD);
    if (cutEnd > cutStart) {
      keep.push({ start: cursor, end: cutStart });
      cursor = cutEnd;
    }
  }
  if (cursor < duration) keep.push({ start: cursor, end: duration });
  const segments = keep.filter((k) => k.end - k.start > 0.05);

  if (segments.length <= 1) {
    // Still re-encodes (rather than stream-copying) so the resolution cap applies even when
    // no dead air was found — an uncapped 4K passthrough would just OOM the finalize step instead.
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(["-vf", SCALE_FILTER, "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac"])
        .save(outputPath)
        .on("end", () => resolve())
        .on("error", reject);
    });
    return;
  }

  const segmentPaths: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segPath = `${tmpDir}/seg-${i}.mp4`;
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(segments[i].start)
        .duration(segments[i].end - segments[i].start)
        .outputOptions([
          "-vf",
          SCALE_FILTER,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-c:a",
          "aac",
          "-avoid_negative_ts",
          "make_zero",
        ])
        .save(segPath)
        .on("end", () => resolve())
        .on("error", reject);
    });
    segmentPaths.push(segPath);
  }

  const listPath = `${tmpDir}/concat-list.txt`;
  await writeFile(listPath, segmentPaths.map((p) => `file '${p}'`).join("\n"));

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(["-f", "concat", "-safe", "0"])
      .outputOptions(["-c", "copy"])
      .save(outputPath)
      .on("end", () => resolve())
      .on("error", reject);
  });
}

export function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(["-vn", "-acodec", "libmp3lame", "-q:a", "4"])
      .save(outputPath)
      .on("end", () => resolve())
      .on("error", reject);
  });
}

/**
 * Burns in captions and, for free-tier exports, a watermark — this is the actual enforcement
 * of the paywall on the real file, not just a UI preview. `watermark` is decided once, at
 * upload time, from the user's billing status then (see projects.watermark).
 */
export function finalizeVideo(inputPath: string, srtPath: string, watermark: boolean, outputPath: string): Promise<void> {
  // ffmpeg's subtitles filter treats ':' as an option separator, so a Windows-style drive
  // letter path needs escaping — irrelevant on Railway's Linux runtime, but harmless to guard.
  // A single backslash escape alone isn't enough for ffmpeg's own filtergraph option parser
  // (it still splits on the colon); wrapping the whole path in single quotes on top of that
  // escape is what actually keeps it intact — verified against real ffmpeg output.
  const escapedSrtPath = `'${srtPath.replace(/\\/g, "/").replace(/:/g, "\\:")}'`;
  const captionStyle =
    "FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,Alignment=2,MarginV=70";

  const filters = [`subtitles=${escapedSrtPath}:force_style='${captionStyle}'`];
  if (watermark) {
    filters.push(
      "drawtext=text='CUTFORGE':fontcolor=white@0.75:fontsize=22:x=w-tw-24:y=h-th-24:box=1:boxcolor=black@0.4:boxborderw=8"
    );
  }

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(["-vf", filters.join(","), "-c:a", "copy"])
      .save(outputPath)
      .on("end", () => resolve())
      .on("error", reject);
  });
}
