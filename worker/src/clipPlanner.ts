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

// A clip under ~30s reads as an abrupt fragment rather than a real standalone short, regardless
// of how short the source video is — a 5-minute source doesn't get a pass to produce choppier
// clips than a 30-minute one. If a video genuinely doesn't have enough for even one clip this
// long, planClips returns fewer candidates (down to zero, which fails the job) rather than ever
// shortening this floor.
const MIN_CLIP_SECONDS = 30;
const MAX_CLIP_SECONDS = 90;

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildTranscriptText(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text.trim()}`).join("\n");
}

function buildPrompt(segments: TranscriptSegment[], videoDurationSeconds: number): string {
  return `You are an expert short-form video editor. Below is a timestamped transcript of a ${Math.round(
    videoDurationSeconds
  )}-second video. Find up to 5 of the strongest standalone moments to turn into short vertical clips (each ${MIN_CLIP_SECONDS}-${MAX_CLIP_SECONDS} seconds long) for TikTok, Instagram Reels, and YouTube Shorts.

Every clip must be at least ${MIN_CLIP_SECONDS} seconds long — never shorter, even if that means finding fewer moments overall. Match the count to what the video actually supports, not a fixed target: a short or low-event video may only have 1-2 real standalone moments that hold up at this length, and returning fewer clips is the correct outcome in that case. Never pad the count with a weak, repetitive, or overlapping clip just to reach a higher number.

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

function isValidCandidate(c: unknown, videoDurationSeconds: number): c is ClipCandidate {
  if (typeof c !== "object" || c === null) return false;
  const { startTime, endTime, hook, caption, viralScore } = c as Record<string, unknown>;
  if (typeof startTime !== "number" || typeof endTime !== "number" || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return false;
  }
  if (typeof hook !== "string" || !hook.trim() || typeof caption !== "string" || !caption.trim()) return false;
  if (typeof viralScore !== "number" || !Number.isFinite(viralScore) || viralScore < 0 || viralScore > 100) return false;
  if (startTime < 0 || endTime > videoDurationSeconds || endTime <= startTime) return false;
  const duration = endTime - startTime;
  if (duration < MIN_CLIP_SECONDS || duration > MAX_CLIP_SECONDS) return false;
  return true;
}

/**
 * Turns a timestamped transcript into up to 5 candidate short-clip moments via an LLM — real
 * timestamps, a hook line, and a caption per candidate. The count adapts to what the video
 * actually supports (see buildPrompt) rather than targeting a fixed number, since every
 * candidate must still be at least MIN_CLIP_SECONDS long regardless of the source's own length.
 * This only plans WHAT to clip; it
 * doesn't render anything (mirrors the existing transcribeCaptions/finalizeVideo split: get real
 * data, then act on it as a separate step).
 */
export async function planClips(segments: TranscriptSegment[], videoDurationSeconds: number): Promise<ClipCandidate[]> {
  if (segments.length === 0) throw new Error("Cannot plan clips from an empty transcript");

  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: buildPrompt(segments, videoDurationSeconds) }],
      });

      const raw = response.choices[0]?.message?.content;
      if (!raw) throw new Error("Empty response from clip planning model");

      const parsed: unknown = JSON.parse(raw);
      const clipsRaw = (parsed as { clips?: unknown[] }).clips;
      if (!Array.isArray(clipsRaw)) throw new Error("Response JSON has no clips array");

      const validCandidates = clipsRaw
        .filter((c): c is ClipCandidate => isValidCandidate(c, videoDurationSeconds))
        .map((c) => ({ ...c, viralScore: Math.round(c.viralScore) }));

      console.log(`Clip planning attempt ${attempt}: ${clipsRaw.length} candidate(s) returned, ${validCandidates.length} valid`);
      if (validCandidates.length === 0) {
        throw new Error(`Model returned ${clipsRaw.length} candidate(s) but none passed validation`);
      }

      // Keep the 5 highest-scoring candidates (not just the first 5), then present them back in
      // chronological order — position in the DB should reflect where a clip falls in the
      // source video, but which 5 survive the cap should be a quality decision, not an
      // artifact of whatever order the model happened to list them in.
      return validCandidates
        .sort((a, b) => b.viralScore - a.viralScore)
        .slice(0, 5)
        .sort((a, b) => a.startTime - b.startTime);
    } catch (err) {
      lastError = err;
      console.error(`Clip planning attempt ${attempt}/${MAX_ATTEMPTS} failed:`, describeError(err));
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }

  throw new Error(`Clip planning failed after ${MAX_ATTEMPTS} attempts: ${describeError(lastError)}`);
}
