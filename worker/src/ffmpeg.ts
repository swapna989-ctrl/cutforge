import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";
import { spawn } from "node:child_process";
import { copyFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath?.path) ffmpeg.setFfprobePath(ffprobePath.path);

export type SilenceInterval = { start: number; end: number };

// Caps the long edge at 720p-equivalent before any re-encode. Measured against a real 13s
// iPhone clip (1080x1920 h264 @ 60fps, 36MB, ~23Mbps): a 1920 cap left it untouched and still
// peaked at ~683MB RSS for one encode, which exceeds Railway's 1GB *total container* budget
// once Node's own footprint is added. This combination measured ~235MB peak for that file.
// `-2` keeps the other edge's aspect ratio while forcing it even, which libx264 requires.
const SCALE_FILTER = "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'";

// A container commonly reports the *host's* CPU count rather than its own quota, and both the
// h264 decoder and x264 auto-size their thread pools (and per-thread frame buffers) from that.
// On a 2-vCPU/1GB Railway instance sitting on a many-core host, that alone can allocate far
// past the memory limit before any real work happens, so pin it explicitly at both ends.
const THREAD_LIMIT = "2";

// Applies to the *decoder*. ffmpeg only honours -threads for decoding when it appears before
// -i; the same flag in output position configures the encoder instead, which is why setting it
// only on the output left decode threads unbounded.
const DECODE_OPTS = ["-threads", THREAD_LIMIT];

// Caps libx264's own internal buffers (lookahead queue, reference frames, thread pool). 30fps
// caps frame throughput for phone sources that shoot 60 — social output doesn't need more.
const MEMORY_SAFE_X264 = [
  "-r",
  "30",
  "-threads",
  THREAD_LIMIT,
  "-preset",
  "veryfast",
  "-x264-params",
  `rc-lookahead=10:ref=1:threads=${THREAD_LIMIT}`,
];

/**
 * Runs a fluent-ffmpeg command, attaching the exact command line and the tail of ffmpeg's own
 * stderr to any failure. Without this an OOM kill surfaces as a bare "killed with signal
 * SIGKILL" with no indication of which invocation died or what it was doing.
 */
function runFfmpeg(command: ffmpeg.FfmpegCommand, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let commandLine = "";
    const stderrTail: string[] = [];
    command
      .on("start", (cl: string) => {
        commandLine = cl;
      })
      .on("stderr", (line: string) => {
        stderrTail.push(line);
        if (stderrTail.length > 25) stderrTail.shift();
      })
      .on("end", () => resolve())
      .on("error", (err: Error) => {
        reject(new Error(`${err.message}\ncmd: ${commandLine}\nstderr tail:\n${stderrTail.join("\n")}`));
      })
      .save(outputPath);
  });
}

/** Runs ffmpeg's silencedetect filter and parses the silence_start/silence_end pairs from stderr. */
export function detectSilences(inputPath: string, noiseDb = -30, minDurationSec = 0.6): Promise<SilenceInterval[]> {
  return new Promise((resolve, reject) => {
    // -vn: silencedetect only needs the audio stream, and decoding video we're about to
    // discard anyway wastes real memory/CPU on a large source.
    const args = [
      ...DECODE_OPTS,
      "-i",
      inputPath,
      "-vn",
      "-af",
      `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`,
      "-f",
      "null",
      "-",
    ];
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
 * Decodes the source exactly once at its native resolution/codec and re-encodes it down to the
 * capped resolution immediately. Without this, cutSilences would re-open and re-decode the
 * original source once per kept segment — each decode pays the full native-resolution memory
 * cost regardless of output scale, since scaling happens after decode in the filter graph.
 */
export function normalizeResolution(inputPath: string, outputPath: string): Promise<void> {
  return runFfmpeg(
    ffmpeg(inputPath)
      .inputOptions(DECODE_OPTS)
      .outputOptions(["-vf", SCALE_FILTER, "-c:v", "libx264", ...MEMORY_SAFE_X264, "-c:a", "aac"]),
    outputPath
  );
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
    // Still re-encodes (rather than stream-copying) so the caps apply even when no dead air
    // was found. A no-op once inputPath is already normalizeResolution()'d, kept as a safety net.
    await runFfmpeg(
      ffmpeg(inputPath)
        .inputOptions(DECODE_OPTS)
        .outputOptions(["-vf", SCALE_FILTER, "-c:v", "libx264", ...MEMORY_SAFE_X264, "-c:a", "aac"]),
      outputPath
    );
    return;
  }

  const segmentPaths: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segPath = `${tmpDir}/seg-${i}.mp4`;
    await runFfmpeg(
      ffmpeg(inputPath)
        .inputOptions(DECODE_OPTS)
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
        ]),
      segPath
    );
    segmentPaths.push(segPath);
  }

  const listPath = `${tmpDir}/concat-list.txt`;
  await writeFile(listPath, segmentPaths.map((p) => `file '${p}'`).join("\n"));

  await runFfmpeg(
    ffmpeg().input(listPath).inputOptions(["-f", "concat", "-safe", "0"]).outputOptions(["-c", "copy"]),
    outputPath
  );
}

// One shared target size per project ratio, used only to bring multiple clips of possibly
// different native resolutions into an identical format before concatenation. Matches the
// existing 1280-long-edge memory budget (see SCALE_FILTER's own comment) so multi-clip encodes
// stay within the same measured-safe footprint as the single-clip path.
const MULTI_CLIP_TARGET_DIMENSIONS: Record<"9:16" | "16:9", { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
};

export function multiClipTargetDimensions(ratio: "9:16" | "16:9"): { width: number; height: number } {
  return MULTI_CLIP_TARGET_DIMENSIONS[ratio];
}

/**
 * Normalizes one clip to an EXACT, caller-specified resolution — unlike normalizeResolution
 * (which scales each source relative to its own aspect ratio, so two differently-shaped
 * sources can land on two different output sizes), every clip run through this function for
 * the same project ends up with identical width/height/codec/pixel format/frame rate. That's
 * what concatClips's stream-copy concat actually requires to be safe (confirmed by a real
 * failure: two clips at 640x360 and 480x360 concatenated with exit code 0, but the output
 * silently dropped the second clip's content entirely).
 *
 * Scales to cover the target box (`force_original_aspect_ratio=increase`), which can only ever
 * grow past the box on one axis, never stretch either axis independently, then center-crops the
 * overflow — chosen over letterboxing so mixed portrait/landscape clips fill the frame the same
 * way a phone-shot reel or short does, rather than adding black bars.
 */
export function normalizeToTargetResolution(inputPath: string, outputPath: string, width: number, height: number): Promise<void> {
  const filter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  return runFfmpeg(
    ffmpeg(inputPath)
      .inputOptions(DECODE_OPTS)
      .outputOptions(["-vf", filter, "-c:v", "libx264", ...MEMORY_SAFE_X264, "-pix_fmt", "yuv420p", "-c:a", "aac"]),
    outputPath
  );
}

/**
 * Concatenates clips that have already been brought to an identical format (see
 * normalizeToTargetResolution) into one file, using the exact same concat-demuxer pattern
 * cutSilences uses to stitch its own "keep" segments back together. A single clip is just
 * copied through rather than re-encoded — there's nothing to join.
 */
export async function concatClips(inputPaths: string[], outputPath: string, tmpDir: string): Promise<void> {
  if (inputPaths.length === 1) {
    await copyFile(inputPaths[0], outputPath);
    return;
  }

  const listPath = join(tmpDir, "clips-concat-list.txt");
  await writeFile(listPath, inputPaths.map((p) => `file '${p}'`).join("\n"));

  await runFfmpeg(
    ffmpeg().input(listPath).inputOptions(["-f", "concat", "-safe", "0"]).outputOptions(["-c", "copy"]),
    outputPath
  );

  // The concat demuxer's stream-copy step silently corrupts/truncates a mismatched segment
  // instead of erroring — ffmpeg exits 0 either way. Comparing the combined duration against
  // the sum of the real inputs' own durations catches that class of failure (here, or any
  // other cause) instead of trusting exit code 0 alone.
  const [inputDurations, combinedDuration] = await Promise.all([
    Promise.all(inputPaths.map((p) => getDuration(p))),
    getDuration(outputPath),
  ]);
  const expectedDuration = inputDurations.reduce((sum, d) => sum + d, 0);
  if (combinedDuration < expectedDuration * 0.9) {
    throw new Error(
      `Concatenated output (${combinedDuration.toFixed(2)}s) is far shorter than its ${inputPaths.length} inputs combined (${expectedDuration.toFixed(2)}s) — concatenation likely dropped a clip.`
    );
  }
}

export function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  return runFfmpeg(
    ffmpeg(inputPath).inputOptions(DECODE_OPTS).outputOptions(["-vn", "-acodec", "libmp3lame", "-q:a", "4"]),
    outputPath
  );
}

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

// Pre-rendered rather than drawn at runtime via the `drawtext` filter: Railway's bundled Linux
// ffmpeg-static binary doesn't include drawtext at all (confirmed from a real production
// failure — "No such filter: 'drawtext'" — despite subtitles/libass working fine), while the
// `overlay` filter used to composite this image is present in essentially every ffmpeg build.
const WATERMARK_PNG = join(ASSETS_DIR, "watermark.png");

// The subtitles filter "working" (no error, real segments transcribed) but rendering zero
// visible text was a second real production failure: libass needs an actual font file to draw
// glyphs with, headless Linux containers commonly ship none at all, and libass fails that
// silently — no error, just nothing drawn. FontName=Arial only ever worked in local testing
// because Windows happens to have Arial installed system-wide, which masked the gap entirely.
// Bundling a real font (Geist, Vercel's OFL-licensed font already vendored by Next.js) and
// pointing `fontsdir` at it removes the dependency on whatever fonts a given host has.
const FONT_NAME = "Geist";
const escapedFontsDir = `'${ASSETS_DIR.replace(/\\/g, "/").replace(/:/g, "\\:")}'`;

function escapeFfmpegPath(p: string): string {
  // ffmpeg's subtitles filter treats ':' as an option separator, so a Windows-style drive
  // letter path needs escaping — irrelevant on Railway's Linux runtime, but harmless to guard.
  // A single backslash escape alone isn't enough for ffmpeg's own filtergraph option parser
  // (it still splits on the colon); wrapping the whole path in single quotes on top of that
  // escape is what actually keeps it intact — verified against real ffmpeg output.
  return `'${p.replace(/\\/g, "/").replace(/:/g, "\\:")}'`;
}

/**
 * Burns in captions and, for free-tier exports, a watermark — this is the actual enforcement
 * of the paywall on the real file, not just a UI preview. `watermark` is decided once, at
 * upload time, from the user's billing status then (see projects.watermark).
 */
export function finalizeVideo(inputPath: string, srtPath: string, watermark: boolean, outputPath: string): Promise<void> {
  const escapedSrtPath = escapeFfmpegPath(srtPath);
  const captionStyle = `FontName=${FONT_NAME},FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,Alignment=2,MarginV=70`;
  const subtitlesFilter = `subtitles=${escapedSrtPath}:force_style='${captionStyle}':fontsdir=${escapedFontsDir}`;

  const command = ffmpeg(inputPath).inputOptions(DECODE_OPTS);

  if (!watermark) {
    return runFfmpeg(
      command.outputOptions(["-vf", subtitlesFilter, "-c:v", "libx264", ...MEMORY_SAFE_X264, "-c:a", "copy"]),
      outputPath
    );
  }

  // With a second input, filtering happens in a labeled complex-filter graph rather than the
  // simple -vf chain, and audio (untouched by any of this) needs an explicit map since it's
  // no longer implicitly carried through as the input's only other stream.
  return runFfmpeg(
    command
      .input(WATERMARK_PNG)
      .complexFilter([`[0:v]${subtitlesFilter}[captioned]`, "[captioned][1:v]overlay=W-w-24:H-h-24[out]"], "out")
      .outputOptions(["-map", "0:a", "-c:v", "libx264", ...MEMORY_SAFE_X264, "-c:a", "copy"]),
    outputPath
  );
}
