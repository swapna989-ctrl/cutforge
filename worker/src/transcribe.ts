import OpenAI from "openai";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { env } from "./env.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 4, timeout: 120000 });

type Word = { word: string; start: number; end: number };
export type TranscriptSegment = { start: number; end: number; text: string };

export type CaptionWord = { text: string; start: number; end: number };
/**
 * One on-screen caption burst — up to 2 lines, each word keeping its own real Whisper timestamp
 * (see buildChunk) so ffmpeg.ts can highlight the exact word being spoken as it plays, not just
 * show/hide the whole burst at once. `lineBreakAfterIndex` is the index of the last word on line
 * 1 (into `words`), or null for a single-line chunk.
 */
export type CaptionChunk = { start: number; end: number; words: CaptionWord[]; lineBreakAfterIndex: number | null };

/**
 * The OpenAI SDK collapses every network-layer failure into a bare "Connection error.", which
 * says nothing about whether it was DNS, a refused connection, a TLS failure or a timeout.
 * The real reason lives on `cause` (and the errno fields underneath it).
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as Error & {
    code?: string;
    errno?: number;
    syscall?: string;
    hostname?: string;
    status?: number;
    cause?: unknown;
  };
  const parts = [e.message];
  if (e.code) parts.push(`code=${e.code}`);
  if (e.errno !== undefined) parts.push(`errno=${e.errno}`);
  if (e.syscall) parts.push(`syscall=${e.syscall}`);
  if (e.hostname) parts.push(`hostname=${e.hostname}`);
  if (e.status !== undefined) parts.push(`status=${e.status}`);
  if (e.cause) parts.push(`cause=(${describeError(e.cause)})`);
  return parts.join(" ");
}

// Groups consecutive words into short bursts that appear one at a time, synced to their own
// real word timestamps, instead of one caption sitting on screen for an entire sentence.
// Whichever cap is hit first ends the chunk — word count alone would let a run of short words
// ("I do not think that is") get too long; character count alone would let a run of long words
// end up as just one or two per chunk.
const MAX_WORDS_PER_CHUNK = 6;
const MAX_CHARS_PER_CHUNK = 42;

// Wraps a chunk's words onto at most 2 lines by recording where the break falls, rather than
// leaving line-wrapping to ffmpeg/libass — that's what actually guarantees "max 2 lines"
// regardless of the output video's width or the caption font's metrics. Each word keeps its own
// start/end (not flattened into a single text string) so the caption burn-in can highlight
// exactly the word being spoken, at exactly the moment it's spoken.
function buildChunk(words: Word[]): CaptionChunk {
  const start = words[0].start;
  const end = words[words.length - 1].end;
  const captionWords: CaptionWord[] = words.map((w) => ({ text: w.word.trim(), start: w.start, end: w.end }));
  const fullText = captionWords.map((w) => w.text).join(" ");

  if (fullText.length <= 24 || words.length < 2) {
    return { start, end, words: captionWords, lineBreakAfterIndex: null };
  }

  const half = fullText.length / 2;
  let splitIndex = Math.ceil(words.length / 2);
  let accumulated = 0;
  for (let i = 0; i < words.length; i++) {
    accumulated += captionWords[i].text.length + 1;
    if (accumulated >= half) {
      splitIndex = i + 1;
      break;
    }
  }
  splitIndex = Math.min(Math.max(splitIndex, 1), words.length - 1);

  // Index of the last word on line 1 — splitIndex words (0..splitIndex-1) sit on line 1.
  return { start, end, words: captionWords, lineBreakAfterIndex: splitIndex - 1 };
}

function chunkWords(words: Word[]): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  let current: Word[] = [];
  let currentChars = 0;

  for (const w of words) {
    const text = w.word.trim();
    if (!text) continue;
    const wouldExceed = current.length >= MAX_WORDS_PER_CHUNK || currentChars + text.length + 1 > MAX_CHARS_PER_CHUNK;
    if (wouldExceed && current.length > 0) {
      chunks.push(buildChunk(current));
      current = [];
      currentChars = 0;
    }
    current.push(w);
    currentChars += text.length + 1;
  }
  if (current.length > 0) chunks.push(buildChunk(current));
  return chunks;
}

/**
 * Transcribes the given audio file into short, word-timestamped caption bursts (see CaptionChunk).
 * whisper-1 is the only current model that supports timestamp_granularities, which is what
 * makes accurately-synced captions — including per-word highlight timing — possible; the
 * newer/cheaper transcribe models don't.
 */
export async function transcribeCaptions(audioPath: string): Promise<CaptionChunk[]> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  const { size: audioBytes } = await stat(audioPath);
  console.log(`Transcribing ${audioPath}: ${audioBytes} bytes`);
  if (audioBytes < 1000) {
    // A near-empty audio file (extraction produced silence/nothing) will make Whisper return
    // zero segments every time — no amount of retrying an API call fixes a bad input file, and
    // failing loudly here beats silently shipping a captionless "success" downstream.
    throw new Error(`Extracted audio is suspiciously small (${audioBytes} bytes) — likely a broken extraction, not a transcription issue`);
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await openai.audio.transcriptions.create({
        // Re-created per attempt: a stream consumed by a failed request can't be replayed.
        file: createReadStream(audioPath),
        model: "whisper-1",
        response_format: "verbose_json",
        // Word-level (not segment-level) timestamps are what makes short, one-at-a-time caption
        // bursts possible — a segment can be a whole sentence, which is exactly the "3-4 lines
        // at once" behavior this replaces.
        timestamp_granularities: ["word"],
      });

      const words = (response as unknown as { words?: Word[] }).words ?? [];
      console.log(`Transcription attempt ${attempt}: got ${words.length} word(s)`);
      if (words.length === 0) {
        // Real speech producing zero words is itself anomalous (seen once against real footage
        // with no diagnosed cause yet) — retry rather than silently write an empty caption track
        // that renders as "success" with no visible captions.
        throw new Error("Whisper returned 0 words for non-trivial audio");
      }

      return chunkWords(words);
    } catch (err) {
      lastError = err;
      console.error(`Transcription attempt ${attempt}/${MAX_ATTEMPTS} failed:`, describeError(err));
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }

  throw new Error(`Transcription failed after ${MAX_ATTEMPTS} attempts: ${describeError(lastError)}`);
}

/**
 * Transcribes the given audio file into sentence-ish segments with real timestamps — for the
 * AI Clip Planner (see clipPlanner.ts), which needs readable, timestamped speech content to
 * reason about, not the short word-level bursts transcribeCaptions builds for on-screen captions.
 * A separate Whisper call from transcribeCaptions' (word-level) one — kept independent for now so
 * neither function's behavior depends on the other; worth merging into one "word"+"segment"
 * call once both are actually used together in the same job.
 */
export async function transcribeSegments(audioPath: string): Promise<TranscriptSegment[]> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  const { size: audioBytes } = await stat(audioPath);
  console.log(`Transcribing ${audioPath} for clip planning: ${audioBytes} bytes`);
  if (audioBytes < 1000) {
    throw new Error(`Extracted audio is suspiciously small (${audioBytes} bytes) — likely a broken extraction, not a transcription issue`);
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await openai.audio.transcriptions.create({
        file: createReadStream(audioPath),
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      });

      const segments = (response as unknown as { segments?: TranscriptSegment[] }).segments ?? [];
      console.log(`Segment transcription attempt ${attempt}: got ${segments.length} segment(s)`);
      if (segments.length === 0) {
        throw new Error("Whisper returned 0 segments for non-trivial audio");
      }

      return segments.map((s) => ({ start: s.start, end: s.end, text: s.text }));
    } catch (err) {
      lastError = err;
      console.error(`Segment transcription attempt ${attempt}/${MAX_ATTEMPTS} failed:`, describeError(err));
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }

  throw new Error(`Segment transcription failed after ${MAX_ATTEMPTS} attempts: ${describeError(lastError)}`);
}
