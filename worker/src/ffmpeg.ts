import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath?.path) ffmpeg.setFfprobePath(ffprobePath.path);

export type SilenceInterval = { start: number; end: number };

// Caps the long edge at 720p-equivalent before any re-encode. Measured empirically against a
// real 13s 1080x1920@60fps iPhone clip (36MB, h264, ~23Mbps) — a naive 1920-cap + light x264
// settings still peaked at ~683MB RSS for that single encode alone, which blows Railway's 1GB
// *total container* budget once Node's own baseline (aws-sdk, openai, supabase-js, etc. all
// loaded) is added on top. The combination below measured ~235MB peak for the same file.
// `-2` keeps the other edge's aspect ratio while forcing it even, which libx264 requires.
const SCALE_FILTER = "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'";

// Caps libx264's own internal buffers (lookahead frame queue + reference frames) and thread
// pool independent of resolution — these scale with frame count/size regardless of the target
// output, and a default lookahead (~40 frames) at even 720p still adds up meaningfully.
// 30fps caps frame throughput for sources that shoot 60fps (common on phones); the pipeline
// doesn't need more than that for social-style output.
const MEMORY_SAFE_X264 = [
  "-r",
  "30",
  "-threads",
  "2",
  "-preset",
  "veryfast",
  "-x264-params",
  "rc-lookahead=10:ref=1:threads=2",
];

/**
 * Decodes the source exactly once at its native resolution/codec and re-encodes it down to the
 * capped resolution immediately. Without this, cutSilences would re-open and re-decode the
 * original 4K/HEVC source once per kept segment — each decode pays the full native-resolution
 * memory cost regardless of the output scale, since scaling happens after decode in the filter
 * graph. Doing that decode once here, up front, is what actually keeps the worker under
 * Railway's 1GB container limit; the per-segment scale filter alone wasn't enough because it
 * only shrinks the *encode* side, not the heavier HEVC *decode* side.
 */
export function normalizeResolution(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(["-vf", SCALE_FILTER, "-c:v", "libx264", ...MEMORY_SAFE_X264, "-c:a", "aac"])
      .save(outputPath)
      .on("end", () => resolve())
      .on("error", reject);
  });
}

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
    // no dead air was found — an uncapped source would just OOM the finalize step instead.
    // A no-op once inputPath is already normalizeResolution()'d, kept as a safety net.
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(["-vf", SCALE_FILTER, "-c:v", "libx264", ...MEMORY_SAFE_X264, "-c:a", "aac"])
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
          ...MEMORY_SAFE_X264,
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
      .outputOptions(["-vf", filters.join(","), "-c:v", "libx264", ...MEMORY_SAFE_X264, "-c:a", "copy"])
      .save(outputPath)
      .on("end", () => resolve())
      .on("error", reject);
  });
}
