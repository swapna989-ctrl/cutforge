import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";
import { spawn } from "node:child_process";
import { copyFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaptionChunk } from "./transcribe.js";

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

/** Probes the real output dimensions — used to place captions proportionally (e.g. "bottom
 *  third") since a fixed pixel margin would land in a different spot on every resolution this
 *  pipeline can produce (multi-clip's fixed targets, or the single-clip path's source-scaled one). */
export function getVideoDimensions(inputPath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) return reject(err);
      const videoStream = data.streams.find((s) => s.codec_type === "video");
      if (!videoStream?.width || !videoStream?.height) {
        return reject(new Error(`Could not determine video dimensions for ${inputPath}`));
      }
      resolve({ width: videoStream.width, height: videoStream.height });
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

/**
 * Extracts [startSeconds, endSeconds) from inputPath as its own standalone file — used to cut
 * one AI Clip Planner candidate out of the (already normalized and dead-air-trimmed) source.
 * Re-encodes rather than stream-copying, for the same reason cutSilences' own segment
 * extraction does: `-ss`/`-t` with stream copy only seeks to the nearest keyframe, which is
 * imprecise, while re-encoding gives a frame-accurate cut at the planner's exact timestamps.
 */
export function extractClipRange(inputPath: string, startSeconds: number, endSeconds: number, outputPath: string): Promise<void> {
  return runFfmpeg(
    ffmpeg(inputPath)
      .inputOptions(DECODE_OPTS)
      .setStartTime(startSeconds)
      .duration(endSeconds - startSeconds)
      .outputOptions(["-c:v", "libx264", ...MEMORY_SAFE_X264, "-c:a", "aac", "-avoid_negative_ts", "make_zero"]),
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

export type CaptionStyle = "classic" | "bold_yellow" | "rose";

type CaptionPresetSpec = {
  fontSize: number;
  bold: boolean;
  /** ASS color format is &HAABBGGRR — reversed byte order from a normal #RRGGBB hex string. */
  primaryColor: string;
  outlineColor: string;
  outlineWidth: number;
  /**
   * Color the one word currently being spoken switches to — null means no highlight at all,
   * rendering exactly like the original single-color captions this replaced (kept as the
   * `classic` preset for anyone who prefers the plain look).
   */
  highlightColor: string | null;
};

// Named bundles, not raw sliders — chosen after looking at how vugolaai.com's own caption
// editor actually splits this up (Presets tab vs. a separate Font/Effects tab): a preset picker
// covers the common case, without us needing to expose every individual knob yet.
const CAPTION_PRESETS: Record<CaptionStyle, CaptionPresetSpec> = {
  classic: {
    fontSize: 20,
    bold: false,
    primaryColor: "&H00FFFFFF", // white
    outlineColor: "&H00000000", // black
    outlineWidth: 5,
    highlightColor: null,
  },
  bold_yellow: {
    fontSize: 22,
    bold: true,
    primaryColor: "&H00FFFFFF", // white
    outlineColor: "&H00000000", // black
    outlineWidth: 6,
    highlightColor: "&H0000FFFF", // yellow — the current word "pops" mid-sentence
  },
  rose: {
    fontSize: 22,
    bold: true,
    primaryColor: "&H00FFFFFF", // white
    outlineColor: "&H00000000", // black
    outlineWidth: 6,
    highlightColor: "&H009583ED", // Flovura's own rose accent (#ed8395), converted to ASS BGR
  },
};

/** ASS override tags use `{` `}` `\` as syntax — a real transcript essentially never contains
 *  these, but stripping them defensively costs nothing and guarantees a word can't corrupt the
 *  tag stream around it. */
function escapeAssText(text: string): string {
  return text.replace(/[{}\\]/g, "");
}

/** "0:00:01.96" — ASS's own H:MM:SS.CC (centiseconds) time format, built directly from a real
 *  seconds value rather than round-tripping through SRT's H:MM:SS,mmm string format. */
function toAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const centiseconds = Math.round((clamped - Math.floor(clamped)) * 100);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${hours}:${pad(minutes)}:${pad(secs)}.${pad(centiseconds)}`;
}

/** Joins a chunk's words back into text with a line break at lineBreakAfterIndex — the plain,
 *  no-highlight rendering, and also the base every highlighted word is built from below. */
function plainChunkText(chunk: CaptionChunk, wordOverride?: (word: CaptionWordLike, index: number) => string): string {
  const parts: string[] = [];
  chunk.words.forEach((word, i) => {
    parts.push(wordOverride ? wordOverride(word, i) : escapeAssText(word.text));
    if (i === chunk.lineBreakAfterIndex) parts.push("\\N");
    else if (i < chunk.words.length - 1) parts.push(" ");
  });
  return parts.join("");
}

type CaptionWordLike = CaptionChunk["words"][number];

/** &H00BBGGRR (style-line format, with an alpha byte) -> &HBBGGRR& (inline \c override format,
 *  without one) — ASS uses two different color syntaxes and neither is a prefix of the other. */
function inlineColor(styleColor: string): string {
  return `${styleColor.replace(/^&H00/, "&H")}&`;
}

/**
 * One chunk of on-screen text can need several *separate* Dialogue events, not one: ASS's own
 * per-word karaoke tag (\k) turned out to only support a cumulative two-color sweep (everything
 * already "sung" one color, everything still upcoming the other — confirmed against real
 * libass output), not an isolated single-word pop, which is the actual effect we want. Emitting
 * one event per word instead — spanning just that word's own [start, end], with the full line's
 * text repeated but only that one word wrapped in an inline color override — gets the real
 * effect: because every event shows pixel-identical text at the same position except for the one
 * recolored word, and no two of a chunk's events overlap in time, it reads as that single word
 * changing color while the rest of the line stays put. Gaps between words are folded into the
 * *next* word's event (its start is the previous word's end) so there's no dead air with nothing
 * highlighted. Returns a single event for the whole chunk when there's no highlight color at all.
 */
function buildChunkEvents(chunk: CaptionChunk, highlightColor: string | null, baseColor: string): { start: number; end: number; text: string }[] {
  if (!highlightColor) {
    return [{ start: chunk.start, end: chunk.end, text: plainChunkText(chunk) }];
  }

  const highlightTag = inlineColor(highlightColor);
  const baseTag = inlineColor(baseColor);
  let cumulative = chunk.start;

  return chunk.words.map((word, i) => {
    const text = plainChunkText(chunk, (w, j) => {
      const escaped = escapeAssText(w.text);
      return j === i ? `{\\c${highlightTag}}${escaped}{\\c${baseTag}}` : escaped;
    });
    const event = { start: cumulative, end: word.end, text };
    cumulative = word.end;
    return event;
  });
}

/**
 * Builds a complete .ass document with its own PlayResX/PlayResY set to the REAL output
 * dimensions. This is necessary, not cosmetic: rendering MarginV without declaring these lands it
 * against libass's own default script resolution rather than the actual video frame — confirmed
 * against a real 1280-tall render where a MarginV computed from the true height still landed
 * captions near mid-frame instead of the bottom third. Declaring PlayResX/Y ourselves, matching
 * the real frame, removes that ambiguity: every pixel value in the style below maps 1:1 onto the
 * actual output.
 */
function buildAssDocument(chunks: CaptionChunk[], style: CaptionStyle, width: number, height: number, marginV: number): string {
  const preset = CAPTION_PRESETS[style];

  // BorderStyle=1 is libass's "outline" style (as opposed to 3, "opaque box") — Outline is then
  // the stroke width in pixels and OutlineColour the stroke's own color, fully opaque so it reads
  // as a clean stroke rather than a tinted box. Alignment=2 is bottom-center; MarginV keeps the
  // caption block inside the bottom third without pinning it to the very edge; MarginL/R keep it
  // off the side edges. SecondaryColour is unused — the per-word highlight (see buildChunkEvents)
  // is done with inline \c overrides on individual events instead, not this style's own colors.
  const styleLine = [
    "Default",
    FONT_NAME,
    String(preset.fontSize),
    preset.primaryColor,
    preset.primaryColor,
    preset.outlineColor,
    "&H00000000", // BackColour: unused (only applies to BorderStyle 3's box fill)
    preset.bold ? "-1" : "0",
    "0",
    "0",
    "0", // Italic, Underline, StrikeOut
    "100",
    "100",
    "0",
    "0", // ScaleX, ScaleY, Spacing, Angle
    "1", // BorderStyle: outline, not opaque box
    String(preset.outlineWidth),
    "0", // Shadow
    "2", // Alignment: bottom-center
    "48",
    "48",
    String(marginV), // MarginL, MarginR, MarginV
    "1", // Encoding
  ].join(",");

  const events = chunks
    .flatMap((c) => buildChunkEvents(c, preset.highlightColor, preset.primaryColor))
    .map((e) => `Dialogue: 0,${toAssTime(e.start)},${toAssTime(e.end)},Default,,0,0,0,,${e.text}`)
    .join("\n");

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}

/**
 * Burns in captions and, for free-tier exports, a watermark — this is the actual enforcement
 * of the paywall on the real file, not just a UI preview. `watermark` is decided once, at
 * upload time, from the user's billing status then (see projects.watermark).
 *
 * `outputWidth`/`outputHeight` are the real dimensions of `inputPath` (see getVideoDimensions) —
 * see buildAssDocument for why they matter. `assPath` is just a scratch file this writes to and
 * points ffmpeg's subtitles filter at — callers own tmpDir cleanup, same as every other
 * intermediate file in the pipeline.
 */
export async function finalizeVideo(
  inputPath: string,
  chunks: CaptionChunk[],
  captionStyle: CaptionStyle,
  watermark: boolean,
  outputWidth: number,
  outputHeight: number,
  outputPath: string,
  assPath: string
): Promise<void> {
  const marginV = Math.round(outputHeight * 0.1);
  await writeFile(assPath, buildAssDocument(chunks, captionStyle, outputWidth, outputHeight, marginV), "utf-8");

  const escapedAssPath = escapeFfmpegPath(assPath);
  const subtitlesFilter = `subtitles=${escapedAssPath}:fontsdir=${escapedFontsDir}`;

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
