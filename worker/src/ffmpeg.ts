import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

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

export function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  return runFfmpeg(
    ffmpeg(inputPath).inputOptions(DECODE_OPTS).outputOptions(["-vn", "-acodec", "libmp3lame", "-q:a", "4"]),
    outputPath
  );
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

  return runFfmpeg(
    ffmpeg(inputPath)
      .inputOptions(DECODE_OPTS)
      .outputOptions(["-vf", filters.join(","), "-c:v", "libx264", ...MEMORY_SAFE_X264, "-c:a", "copy"]),
    outputPath
  );
}
