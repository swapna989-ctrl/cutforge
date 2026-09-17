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

// Not a target — there is no fixed clip count any more (see buildPrompt). This is only a sanity
// ceiling so a pathological response, or a genuinely very eventful long source, can't blow the
// render loop up to dozens of clips in one job.
const MAX_CANDIDATES = 15;

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildTranscriptText(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text.trim()}`).join("\n");
}

function buildPrompt(segments: TranscriptSegment[], videoDurationSeconds: number, bounds: { min: number; max: number }): string {
  return `You are an expert short-form video editor. Below is a timestamped transcript of a ${Math.round(
    videoDurationSeconds
  )}-second video. Find every genuinely strong, standalone moment worth turning into a short vertical clip (each ${bounds.min}-${bounds.max} seconds long) for TikTok, Instagram Reels, and YouTube Shorts.

There is no fixed number to hit — match the count to what this specific video actually contains. A short or low-event video might genuinely only have 1-2 moments that hold up on their own; a long, eventful one might have 8-10 or more. Never pad the count with a weak, repetitive, or overlapping clip just to reach a higher number, and never leave out a genuinely strong moment just to keep the count low. Every clip must be at least ${bounds.min} seconds long — never shorter, even if that means finding fewer moments overall.

Pick moments that are surprising, funny, emotionally resonant, controversial, or contain a clear self-contained story or insight. Each clip must start and end at a natural sentence boundary — never mid-sentence or mid-thought. startTime and endTime must be real seconds that fall within the transcript's own time range below.

For each candidate return:
- "startTime": number (seconds)
- "endTime": number (seconds)
- "hook": a punchy, curiosity-driving opening line under 12 words, written as if spoken by the creator — not a generic summary
- "caption": a short 1-2 sentence social caption for the post itself, no hashtags
- "viralScore": an integer 0-100 estimating how likely this specific clip is to perform well as a short-form video — weigh hook strength, emotional impact or surprise, and how well it stands alone without the rest of the video. Use the full range; do not default everything to the same number.

Respond with ONLY valid JSON of this exact shape, nothing else:
{"clips": [{"startTime": number, "endTime": number, "hook": string, "caption": string, "viralScore": number}]}

Transcript:
${buildTranscriptText(segments)}`;
}

type RawCandidate = { startTime: number; endTime: number; hook: string; caption: string; viralScore: number };

/** Type/shape validation only — NOT duration bounds, which must be checked after snapToBoundary
 *  below moves startTime/endTime, not before. */
function isWellFormed(c: unknown): c is RawCandidate {
  if (typeof c !== "object" || c === null) return false;
  const { startTime, endTime, hook, caption, viralScore } = c as Record<string, unknown>;
  if (typeof startTime !== "number" || typeof endTime !== "number" || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return false;
  }
  if (typeof hook !== "string" || !hook.trim() || typeof caption !== "string" || !caption.trim()) return false;
  if (typeof viralScore !== "number" || !Number.isFinite(viralScore) || viralScore < 0 || viralScore > 100) return false;
  return true;
}

/**
 * Snaps a raw LLM-chosen timestamp onto the nearest real transcript segment edge. The model's
 * startTime/endTime are just numbers it read off the prompt's own [MM:SS] markers and picked —
 * nothing forces them to land exactly where Whisper actually detected a sentence/utterance
 * boundary, and a real observed clip ending mid-word at an arbitrary-feeling point is exactly
 * what "ask nicely in the prompt" alone doesn't prevent. `segments` (from transcribeSegments) are
 * real detected speech boundaries; snapping onto one is what actually guarantees a clean edge.
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
 * Turns a timestamped transcript into candidate short-clip moments via an LLM — real timestamps
 * (snapped onto real transcript boundaries, see snapToBoundary), a hook line, and a caption per
 * candidate. The count adapts to what the video actually supports (see buildPrompt) rather than
 * targeting a fixed number — MAX_CANDIDATES is a safety ceiling, not a target, and every
 * candidate must still fall within `clipLength`'s bounds (see CLIP_LENGTH_BOUNDS) regardless of
 * the source's own length. This only plans WHAT to clip; it doesn't render anything (mirrors the
 * existing transcribeCaptions/finalizeVideo split: get real data, then act on it as a separate
 * step).
 */
export async function planClips(
  segments: TranscriptSegment[],
  videoDurationSeconds: number,
  clipLength: ClipLength
): Promise<ClipCandidate[]> {
  if (segments.length === 0) throw new Error("Cannot plan clips from an empty transcript");
  const bounds = CLIP_LENGTH_BOUNDS[clipLength];

  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: buildPrompt(segments, videoDurationSeconds, bounds) }],
      });

      const raw = response.choices[0]?.message?.content;
      if (!raw) throw new Error("Empty response from clip planning model");

      const parsed: unknown = JSON.parse(raw);
      const clipsRaw = (parsed as { clips?: unknown[] }).clips;
      if (!Array.isArray(clipsRaw)) throw new Error("Response JSON has no clips array");

      // Snapping happens BEFORE the duration check, not after — a candidate the model picked at
      // a valid length can end up shorter or longer once its edges move onto real segment
      // boundaries, and it's the post-snap length that will actually get rendered.
      const snapped = clipsRaw.filter(isWellFormed).map((c) => ({
        ...c,
        startTime: snapToBoundary(c.startTime, segments, "start"),
        endTime: snapToBoundary(c.endTime, segments, "end"),
      }));

      const seen = new Set<string>();
      const validCandidates: ClipCandidate[] = [];
      for (const c of snapped) {
        if (c.startTime < 0 || c.endTime > videoDurationSeconds || c.endTime <= c.startTime) continue;
        const duration = c.endTime - c.startTime;
        if (duration < bounds.min || duration > bounds.max) continue;
        // Two distinct raw candidates can snap onto the same pair of real boundaries — keep the
        // first (already the model's own preferred ordering) rather than rendering a duplicate.
        const key = `${c.startTime.toFixed(2)}-${c.endTime.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        validCandidates.push({ ...c, viralScore: Math.round(c.viralScore) });
      }

      console.log(
        `Clip planning attempt ${attempt}: ${clipsRaw.length} candidate(s) returned, ${validCandidates.length} valid after snapping to real transcript boundaries`
      );
      if (validCandidates.length === 0) {
        throw new Error(`Model returned ${clipsRaw.length} candidate(s) but none passed validation`);
      }

      // Keep the MAX_CANDIDATES highest-scoring candidates (not just the first N — see
      // MAX_CANDIDATES' own comment, this is a safety ceiling, not a target), then present them
      // back in chronological order — position in the DB should reflect where a clip falls in
      // the source video, but which ones survive the ceiling should be a quality decision, not
      // an artifact of whatever order the model happened to list them in.
      return validCandidates
        .sort((a, b) => b.viralScore - a.viralScore)
        .slice(0, MAX_CANDIDATES)
        .sort((a, b) => a.startTime - b.startTime);
    } catch (err) {
      lastError = err;
      console.error(`Clip planning attempt ${attempt}/${MAX_ATTEMPTS} failed:`, describeError(err));
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }

  throw new Error(`Clip planning failed after ${MAX_ATTEMPTS} attempts: ${describeError(lastError)}`);
}
