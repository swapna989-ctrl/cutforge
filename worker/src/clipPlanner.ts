import OpenAI from "openai";
import { env } from "./env.js";
import { describeError, type TranscriptSegment } from "./transcribe.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 4, timeout: 120000 });

// Cheap and fast enough for a JSON-extraction task like this; swap for a stronger model later
// if candidate quality turns out to need it — nothing else in this file assumes gpt-4o-mini.
const MODEL = "gpt-4o-mini";

export type ClipCandidate = {
  startTime: number;
  endTime: number;
  hook: string;
  caption: string;
  /** LLM-estimated 0-100 confidence that this clip performs well as a standalone short —
   *  produced by the same call that picks the candidate, since it already has full transcript
   *  context to judge hook strength/emotional impact/self-containedness. Not a measured
   *  outcome (no posted-clip performance data exists yet) — an estimate, same as the hook and
   *  caption already are. */
  viralScore: number;
};

export type ClipLength = "auto" | "short" | "long";

// "auto" is the original, unqualified default (a clip under ~30s reads as an abrupt fragment
// rather than a real standalone short, regardless of how short the source video is — a 5-minute
// source doesn't get a pass to produce choppier clips than a 30-minute one) — kept exactly as-is.
// "short"/"long" are real user choices to trade that floor for volume, or the ceiling for tighter
// pacing; a video that genuinely doesn't have enough for even one clip at the chosen length still
// returns fewer candidates (down to zero, which fails the job) rather than ever bending the range.
const CLIP_LENGTH_BOUNDS: Record<ClipLength, { min: number; max: number }> = {
  auto: { min: 30, max: 90 },
  short: { min: 15, max: 30 },
  long: { min: 30, max: 60 },
};

// Dead air is cut out of a clip after the moment is chosen, so a clip is planned this much longer than
// the length the user asked for (see planClips).
const DEAD_AIR_ALLOWANCE = 1.1;

// Roughly how much video one clip should be drawn from. A 15-minute video asks for 6, a 2-hour
// stream asks for the ceiling. Measured against the competitor a user compared us with: a
// 128-minute video there produced 50 clips, about one per 2.5 minutes.
const SECONDS_PER_CLIP = 150;

// Never ask for fewer than this, even for a 5-minute video: a user who gets one clip back feels
// short-changed, and the repair/overlap rules below already stop weak or duplicate picks.
const MIN_TARGET = 3;

// The ceiling on one job. Each clip is a real render (about 20-40s of worker time), and this worker
// takes one job at a time, so an unbounded count would let a single long stream block everyone else.
const MAX_CANDIDATES = 50;

/** How many clips to ask for from a video of this length. */
export function targetClipCount(videoDurationSeconds: number): number {
  return Math.min(MAX_CANDIDATES, Math.max(MIN_TARGET, Math.round(videoDurationSeconds / SECONDS_PER_CLIP)));
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Every line is numbered and the model picks clips by line number, not by time. Asked for times, it
// was measured returning nonsense: read off "[7:46]"-style markers it answered 7, 46, 58, 100 for a
// section that began at 466 seconds, and four different picks for the first half of a video all
// came back as 0-30, 1-22, 2-28 and 4-18 -- one clip, four times. Line numbers it handles
// reliably, and turning them into times is then exact rather than something it estimates.
function buildTranscriptText(lines: { index: number; segment: TranscriptSegment }[]): string {
  return lines.map(({ index, segment }) => `[${index}] (${formatTimestamp(segment.start)}) ${segment.text.trim()}`).join("\n");
}

type PlanWindow = { start: number; end: number };

function buildPrompt(
  lines: { index: number; segment: TranscriptSegment }[],
  videoDurationSeconds: number,
  bounds: { min: number; max: number },
  ask: number,
  window: PlanWindow | null
): string {
  const scope = window
    ? `the section from ${formatTimestamp(window.start)} to ${formatTimestamp(window.end)} of a ${Math.round(videoDurationSeconds)}-second video`
    : `a ${Math.round(videoDurationSeconds)}-second video`;
  const spread = window ? "the whole section" : "the whole running time";
  return `You are an expert short-form video editor. Below is the transcript of ${scope}, one numbered line per spoken sentence, each with its time in minutes:seconds. Find the ${ask} strongest standalone moments worth turning into short vertical clips (each ${bounds.min}-${bounds.max} seconds long) for TikTok, Instagram Reels, and YouTube Shorts.

Return ${ask} clips if this ${window ? "section" : "video"} genuinely contains that many moments that hold up on their own. Return fewer only if it truly does not — but look hard first: there is almost always more than a handful. Spread your picks across ${spread} rather than clustering them near the start, and never return two clips that share any line.

Pick moments that are surprising, funny, emotionally resonant, controversial, or contain a clear self-contained story or insight. A clip is a run of consecutive lines, so it always starts and ends on a whole sentence. Use the times in brackets to choose a run that lasts between ${bounds.min} and ${bounds.max} seconds.

For each candidate return:
- "startLine": integer — the number of the first line of the clip, exactly as printed in the square brackets
- "endLine": integer — the number of the last line of the clip (the same as startLine only if that one line is long enough)
- "hook": a punchy, curiosity-driving opening line under 12 words, written as if spoken by the creator — not a generic summary
- "caption": a short 1-2 sentence social caption for the post itself, no hashtags
- "viralScore": an integer 0-100 estimating how likely this specific clip is to perform well as a short-form video — weigh hook strength, emotional impact or surprise, and how well it stands alone without the rest of the video. Use the full range; do not default everything to the same number.

Respond with ONLY valid JSON of this exact shape, nothing else:
{"clips": [{"startLine": integer, "endLine": integer, "hook": string, "caption": string, "viralScore": number}]}

Transcript:
${buildTranscriptText(lines)}`;
}

type RawCandidate = { startLine: number; endLine: number; hook: string; caption: string; viralScore: number };

/** Type/shape validation only — whether the lines exist and the clip's length come after this. */
function isWellFormed(c: unknown): c is RawCandidate {
  if (typeof c !== "object" || c === null) return false;
  const { startLine, endLine, hook, caption, viralScore } = c as Record<string, unknown>;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return false;
  if (typeof hook !== "string" || !hook.trim() || typeof caption !== "string" || !caption.trim()) return false;
  if (typeof viralScore !== "number" || !Number.isFinite(viralScore) || viralScore < 0 || viralScore > 100) return false;
  return true;
}

/**
 * Snaps a time onto the nearest real transcript segment edge. `segments` (from transcribeSegments)
 * are the speech boundaries Whisper actually detected, and landing on one is what guarantees a clean
 * cut rather than one that ends mid-word. The clips the model picks already start and end on whole
 * lines, so this mostly matters to fitToBounds when it grows or trims a clip to fit the length window.
 */
function snapToBoundary(time: number, segments: TranscriptSegment[], edge: "start" | "end"): number {
  if (segments.length === 0) return time;
  if (edge === "start") {
    const containing = segments.find((s) => s.start <= time && time < s.end);
    if (containing) return containing.start;
    const before = segments.filter((s) => s.start <= time).pop();
    return before ? before.start : segments[0].start;
  }
  const containing = segments.find((s) => s.start < time && time <= s.end);
  if (containing) return containing.end;
  const after = segments.find((s) => s.end >= time);
  return after ? after.end : segments[segments.length - 1].end;
}

/**
 * Pulls a candidate's edges onto real sentence boundaries and, if the result is a little too short or
 * too long, repairs it rather than throwing it away. Discarding was why a 15-minute video could come
 * back with two clips (or none): snapping routinely moves an edge a few seconds, and almost half of
 * every model response was being dropped for landing just outside the window. A clip that cannot be
 * repaired at all (nothing to grow into, or no boundary inside the window) is still dropped.
 */
export function fitToBounds(
  startTime: number,
  endTime: number,
  segments: TranscriptSegment[],
  bounds: { min: number; max: number }
): { startTime: number; endTime: number } | null {
  const start = snapToBoundary(startTime, segments, "start");
  let end = snapToBoundary(endTime, segments, "end");
  if (end <= start) return null;

  // Too short: keep taking the next sentence until it is long enough.
  if (end - start < bounds.min) {
    for (const s of segments) {
      if (s.end > end) {
        end = s.end;
        if (end - start >= bounds.min) break;
      }
    }
  }

  // Too long: fall back to the last sentence end that still fits.
  if (end - start > bounds.max) {
    const fits = segments.map((s) => s.end).filter((e) => e > start && e - start >= bounds.min && e - start <= bounds.max);
    if (fits.length === 0) return null;
    end = fits[fits.length - 1];
  }

  const duration = end - start;
  return duration >= bounds.min && duration <= bounds.max ? { startTime: start, endTime: end } : null;
}

/**
 * Keeps the strongest clip out of any group that overlaps in time. Without this a video could come
 * back with two clips covering nearly the same moment (a real result: 0-64s and 48-87s), which reads
 * as padding. A couple of seconds of shared edge is allowed, since snapping can butt two clips
 * together on the same boundary.
 */
export function dropOverlaps(candidates: ClipCandidate[]): ClipCandidate[] {
  const TOLERANCE = 2;
  const kept: ClipCandidate[] = [];
  for (const c of [...candidates].sort((a, b) => b.viralScore - a.viralScore)) {
    if (kept.some((k) => c.startTime < k.endTime - TOLERANCE && c.endTime > k.startTime + TOLERANCE)) continue;
    kept.push(c);
  }
  return kept;
}

// A long video is planned a section at a time. One request over a 2-hour transcript is tens of
// thousands of words: the model skims it, favours the opening, and can't be asked for dozens of
// picks at once. Sections keep each request small enough for it to read properly, spread the picks
// across the whole video by construction, and let a stream be planned in parallel.
const SINGLE_PASS_MAX_SECONDS = 15 * 60;
const WINDOW_SECONDS = 10 * 60;
const WINDOW_CONCURRENCY = 3;

/** The sections a video is planned in: the whole video when short, otherwise equal ~10-minute parts. */
export function planWindows(durationSeconds: number): PlanWindow[] {
  if (durationSeconds <= SINGLE_PASS_MAX_SECONDS) return [{ start: 0, end: durationSeconds }];
  const count = Math.ceil(durationSeconds / WINDOW_SECONDS);
  const length = durationSeconds / count;
  return Array.from({ length: count }, (_, i) => ({ start: i * length, end: (i + 1) * length }));
}

/**
 * Asks the model about one section and returns its clips, already snapped onto real sentence
 * boundaries and repaired. Boundaries are snapped against the WHOLE transcript, not just this
 * section, so a clip that begins near the end of a section can finish naturally in the next one.
 */
async function planWindow(
  allSegments: TranscriptSegment[],
  window: PlanWindow | null,
  videoDurationSeconds: number,
  bounds: { min: number; max: number },
  ask: number
): Promise<ClipCandidate[]> {
  const lines = allSegments
    .map((segment, index) => ({ index, segment }))
    .filter(({ segment }) => !window || (segment.start >= window.start && segment.start < window.end));
  if (lines.length === 0) return []; // a stretch with no speech has nothing to plan from

  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        response_format: { type: "json_object" },
        // Lower than the default so the same video gives a similar answer each time; the picks were
        // varying by a factor of two between identical runs.
        temperature: 0.4,
        messages: [{ role: "user", content: buildPrompt(lines, videoDurationSeconds, bounds, ask, window) }],
      });

      const raw = response.choices[0]?.message?.content;
      if (!raw) throw new Error("Empty response from clip planning model");

      const parsed: unknown = JSON.parse(raw);
      const clipsRaw = (parsed as { clips?: unknown[] }).clips;
      if (!Array.isArray(clipsRaw)) throw new Error("Response JSON has no clips array");

      // A clip is a run of whole lines, so its edges are real sentence boundaries by construction;
      // fitToBounds then repairs one that came out a little too short or too long (the post-repair
      // length is what actually gets rendered). A line number that doesn't exist is dropped.
      const fitted: ClipCandidate[] = [];
      for (const c of clipsRaw.filter(isWellFormed)) {
        const first = allSegments[c.startLine];
        const last = allSegments[c.endLine];
        if (!first || !last) continue;
        const fit = fitToBounds(first.start, last.end, allSegments, bounds);
        if (!fit) continue;
        if (fit.startTime < 0 || fit.endTime > videoDurationSeconds) continue;
        fitted.push({ startTime: fit.startTime, endTime: fit.endTime, hook: c.hook, caption: c.caption, viralScore: Math.round(c.viralScore) });
      }

      console.log(
        `Clip planning${window ? ` [${formatTimestamp(window.start)}-${formatTimestamp(window.end)}]` : ""} attempt ${attempt}: asked for ${ask}, model returned ${clipsRaw.length}, ${fitted.length} usable after snapping/repair`
      );
      // An answer with nothing usable in it is retried like any other failed attempt.
      if (fitted.length === 0) throw new Error(`Model returned ${clipsRaw.length} candidate(s) but none could be fitted to a real clip`);
      return fitted;
    } catch (err) {
      lastError = err;
      console.error(`Clip planning attempt ${attempt}/${MAX_ATTEMPTS} failed:`, describeError(err));
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  throw new Error(`Clip planning failed after ${MAX_ATTEMPTS} attempts: ${describeError(lastError)}`);
}

/**
 * Turns a timestamped transcript into candidate short-clip moments via an LLM — real timestamps
 * (snapped onto real transcript boundaries, see snapToBoundary), a hook line, and a caption per
 * candidate. The model is asked for a real target count scaled to the video's length (see
 * targetClipCount); a long video is planned a section at a time (see planWindows); every candidate is
 * repaired if snapping leaves it slightly outside `clipLength`'s bounds (see fitToBounds); and clips
 * covering the same moment are reduced to the strongest one (see dropOverlaps). This only plans WHAT
 * to clip; it doesn't render anything (mirrors the existing transcribeCaptions/finalizeVideo split:
 * get real data, then act on it as a separate step).
 */
export async function planClips(
  segments: TranscriptSegment[],
  videoDurationSeconds: number,
  clipLength: ClipLength
): Promise<ClipCandidate[]> {
  if (segments.length === 0) throw new Error("Cannot plan clips from an empty transcript");
  // Dead air is taken out of each clip after it is cut (see render.ts), which shortens it by a few
  // percent. Aiming a little longer keeps the finished short inside the length the user chose.
  const chosen = CLIP_LENGTH_BOUNDS[clipLength];
  const bounds = { min: Math.ceil(chosen.min * DEAD_AIR_ALLOWANCE), max: chosen.max };
  const target = targetClipCount(videoDurationSeconds);
  const windows = planWindows(videoDurationSeconds);

  let results: ClipCandidate[][];
  if (windows.length === 1) {
    results = [await planWindow(segments, null, videoDurationSeconds, bounds, target)];
  } else {
    // Each section is asked for its share of the target, with some slack: overlaps and weak picks
    // are trimmed afterwards, and a section with nothing good simply returns fewer.
    results = new Array(windows.length);
    let failed = 0;
    let next = 0;
    const worker = async () => {
      while (next < windows.length) {
        const i = next++;
        const w = windows[i];
        const ask = Math.max(2, Math.ceil(((target * (w.end - w.start)) / videoDurationSeconds) * 1.2));
        try {
          results[i] = await planWindow(segments, w, videoDurationSeconds, bounds, ask);
        } catch (err) {
          // One bad section must not throw away the rest of a long stream's clips.
          failed++;
          results[i] = [];
          console.error(`Clip planning gave up on section ${i + 1}/${windows.length}:`, describeError(err));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(WINDOW_CONCURRENCY, windows.length) }, worker));
    if (failed === windows.length) throw new Error("Clip planning failed for every section of this video");
  }

  const seen = new Set<string>();
  const unique = results.flat().filter((c) => {
    const key = `${c.startTime.toFixed(2)}-${c.endTime.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const validCandidates = dropOverlaps(unique).slice(0, MAX_CANDIDATES);
  console.log(`Clip planning: asked for ${target}, ${unique.length} usable across ${windows.length} section(s), ${validCandidates.length} kept after dropping overlaps`);
  if (validCandidates.length === 0) throw new Error("Model returned candidates but none could be fitted to a real clip");

  // Presented in chronological order: position in the DB should reflect where a clip falls in the
  // source video, while which ones survive stays a quality decision (dropOverlaps and the ceiling
  // both work highest-score-first).
  return validCandidates.sort((a, b) => a.startTime - b.startTime);
}
