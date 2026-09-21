import OpenAI from "openai";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { env } from "./env.js";
import { planAudioChunks } from "./audioChunks.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 4, timeout: 120000 });

type Word = { word: string; start: number; end: number };
export type TranscriptSegment = { start: number; end: number; text: string };

export type CaptionLanguage = "auto" | "hinglish";

// Whisper has no dedicated "output Hinglish" mode — it transcribes in the spoken language's own
// native script by default (Devanagari for Hindi audio), and there's no parameter that changes
// that directly. `prompt` is documented as biasing vocabulary/style toward a sample of text, and
// giving it a real Romanized Hindi-English sentence is the closest real lever to nudge output
// that way. This is a best-effort bias, not a guarantee — Whisper can still drift back to
// Devanagari partway through a longer clip, which is why this is opt-in (see caption_language)
// rather than always applied.
const HINGLISH_PROMPT_HINT =
  "Yaar, aaj maine ek bahut hi zabardast video banaya hai, isko dekhkar aapko bhi maza aayega, chalo shuru karte hain.";

// Same Unicode block as ffmpeg.ts's own DEVANAGARI_RANGE (kept as a separate literal rather than
// a cross-import — that module imports FROM this one, not the other way around).
const DEVANAGARI_RANGE = /[ऀ-ॿ]/;

/**
 * Guarantees Roman-script output for "hinglish" mode instead of just hoping the prompt hint above
 * worked — confirmed by real testing against real audio that the hint alone is genuinely
 * inconsistent (one real segment came back entirely in Devanagari despite it, right alongside
 * another that came back clean). Runs after Whisper as a deterministic post-process: whatever
 * script Whisper actually used, any word still in Devanagari gets transliterated into casual
 * Roman-script Hindi via one batched LLM call — this changes the SCRIPT only, the language and
 * meaning stay Hindi, exactly how a real Hinglish caption is typed, never an actual translation.
 * The full word list (not just the Devanagari ones) is sent in one call so the model has real
 * sentence context for natural spellings, but only words that were actually in Devanagari are
 * ever replaced — an already-Latin word (a code-switched English word mid-sentence) is kept
 * byte-for-byte as Whisper wrote it. Falls back to the original words untouched if the response
 * doesn't parse as a same-length JSON array — never risks misaligning the real per-word
 * timestamps by trusting a shorter/longer/reordered list.
 */
async function transliterateToHinglish(words: Word[]): Promise<Word[]> {
  if (!words.some((w) => DEVANAGARI_RANGE.test(w.word))) return words;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `Here is a Hindi (or mixed Hindi/English) transcript, given as a JSON array of individual words in their original spoken order: ${JSON.stringify(
            words.map((w) => w.word)
          )}

Return ONLY valid JSON of this exact shape: {"words": string[]} -- an array of EXACTLY the same length, in the same order, where:
- Any word written in Devanagari script is transliterated into casual Roman-script Hindi, the way it's commonly typed in Hinglish captions on social media (e.g. है -> hai, नहीं -> nahi, क्या -> kya) -- this changes the SCRIPT only, never the language or meaning. Do not translate anything into English.
- Any word already in Latin script is returned completely unchanged.
Do not merge, split, or reorder words -- the output array length must exactly match the input.`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty response from transliteration model");
    const parsed = JSON.parse(raw) as { words?: unknown };
    if (!Array.isArray(parsed.words) || parsed.words.length !== words.length || !parsed.words.every((w) => typeof w === "string")) {
      throw new Error(`Transliteration response shape mismatch (expected ${words.length} strings)`);
    }

    const transliterated = parsed.words as string[];
    return words.map((w, i) => ({ ...w, word: transliterated[i] }));
  } catch (err) {
    console.error("Hinglish transliteration failed, keeping original script for this chunk:", describeError(err));
    return words;
  }
}

export type CaptionWord = { text: string; start: number; end: number };
/**
 * One on-screen caption burst — up to 3 lines (see CaptionLineCount), each word keeping its own
 * real Whisper timestamp (see buildChunk/buildChunkFlexible) so ffmpeg.ts can highlight the exact
 * word being spoken as it plays, not just show/hide the whole burst at once. `lineBreakIndices` is
 * the index of the last word on each line except the last (into `words`) — empty for a
 * single-line chunk, one entry for 2 lines, up to two entries for 3 lines.
 */
export type CaptionChunk = { start: number; end: number; words: CaptionWord[]; lineBreakIndices: number[] };

export type CaptionLineCount = "auto" | "one_line" | "two_words" | "three_lines";

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
    return { start, end, words: captionWords, lineBreakIndices: [] };
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
  return { start, end, words: captionWords, lineBreakIndices: [splitIndex - 1] };
}

// Independent of buildChunk's own hardcoded 24 above (see CaptionChunk's own note) — buildChunk
// stays untouched on purpose (today's default "auto" caption look already shipped and verified;
// zero reason to risk it by routing it through the more general splitter below), so this can't
// share a constant with it without editing that function.
const SAFE_LINE_CHARS = 24;

// Only "auto" (untouched, above) is exempt — the other three CaptionLineCount modes share these
// per-mode grouping caps. maxLines forced to 1 for `two_words` is deliberate, not derived from the
// character math below: two words read as one short punchy line, never as two near-empty stacked
// lines, so there's no reason to ever let a 2-word chunk wrap.
const LINE_COUNT_BOUNDS: Record<Exclude<CaptionLineCount, "auto">, { maxWords: number; maxChars: number; maxLines: number }> = {
  one_line: { maxWords: 4, maxChars: SAFE_LINE_CHARS, maxLines: 1 },
  two_words: { maxWords: 2, maxChars: 60, maxLines: 1 },
  three_lines: { maxWords: 10, maxChars: 66, maxLines: 3 },
};

/**
 * Generalizes buildChunk's own 2-line character-count split into up to `maxLines - 1` break
 * points via a single forward pass. Two correctness properties that a naive per-target rescan
 * doesn't guarantee (see this session's design review): (1) lines actually needed is capped by
 * `words.length`, not just `maxLines`, so a short chunk never manufactures an empty trailing line;
 * (2) each break is only accepted once enough words remain to give every still-unbroken line at
 * least one word, which — since the scan only ever moves forward — makes each accepted break
 * strictly later than the last, so two breaks can never land on the same or an out-of-order index.
 * A single very long word can still end up alone on an over-width line (breaks only ever fall
 * *between* words) — the same already-accepted limitation buildChunk's own 2-line split has today,
 * not a new one. If the character-target scan still comes up short (that same long-word case can
 * absorb more than one target in a single step), a top-up pass fills any remaining break greedily
 * right after the previous one, which is always valid since `words.length` was already checked.
 */
function buildChunkFlexible(words: Word[], maxLines: number): CaptionChunk {
  const start = words[0].start;
  const end = words[words.length - 1].end;
  const captionWords: CaptionWord[] = words.map((w) => ({ text: w.word.trim(), start: w.start, end: w.end }));
  const fullText = captionWords.map((w) => w.text).join(" ");

  const neededLines = Math.min(Math.ceil(fullText.length / SAFE_LINE_CHARS), maxLines, words.length);
  if (neededLines <= 1) {
    return { start, end, words: captionWords, lineBreakIndices: [] };
  }

  const breaks: number[] = [];
  let accumulated = 0;
  for (let i = 0; i < words.length - 1 && breaks.length < neededLines - 1; i++) {
    accumulated += captionWords[i].text.length + 1;
    const target = (fullText.length * (breaks.length + 1)) / neededLines;
    const wordsLeftAfter = words.length - 1 - i;
    const linesLeftAfter = neededLines - breaks.length - 1;
    if (accumulated >= target && wordsLeftAfter >= linesLeftAfter) {
      breaks.push(i);
    }
  }
  while (breaks.length < neededLines - 1) {
    breaks.push((breaks.length === 0 ? -1 : breaks[breaks.length - 1]) + 1);
  }

  return { start, end, words: captionWords, lineBreakIndices: breaks };
}

function chunkWordsFlexible(words: Word[], bounds: { maxWords: number; maxChars: number; maxLines: number }): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  let current: Word[] = [];
  let currentChars = 0;

  for (const w of words) {
    const text = w.word.trim();
    if (!text) continue;
    const wouldExceed = current.length >= bounds.maxWords || currentChars + text.length + 1 > bounds.maxChars;
    if (wouldExceed && current.length > 0) {
      chunks.push(buildChunkFlexible(current, bounds.maxLines));
      current = [];
      currentChars = 0;
    }
    current.push(w);
    currentChars += text.length + 1;
  }
  if (current.length > 0) chunks.push(buildChunkFlexible(current, bounds.maxLines));
  return chunks;
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
export async function transcribeCaptions(
  audioPath: string,
  language: CaptionLanguage = "auto",
  lineCount: CaptionLineCount = "auto"
): Promise<CaptionChunk[]> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  const { size: audioBytes } = await stat(audioPath);
  console.log(`Transcribing ${audioPath}: ${audioBytes} bytes (language=${language})`);
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
        ...(language === "hinglish" ? { prompt: HINGLISH_PROMPT_HINT } : {}),
      });

      const words = (response as unknown as { words?: Word[] }).words ?? [];
      console.log(`Transcription attempt ${attempt}: got ${words.length} word(s)`);
      if (words.length === 0) {
        // Real speech producing zero words is itself anomalous (seen once against real footage
        // with no diagnosed cause yet) — retry rather than silently write an empty caption track
        // that renders as "success" with no visible captions.
        throw new Error("Whisper returned 0 words for non-trivial audio");
      }

      // Runs on the raw flat word list, before chunking — transliteration doesn't need to know
      // about chunk boundaries, only chunkWords/chunkWordsFlexible do.
      const finalWords = language === "hinglish" ? await transliterateToHinglish(words) : words;

      // chunkWords/buildChunk (today's exact, already-shipped default) handle "auto" directly and
      // stay completely unparameterized — chunkWordsFlexible/buildChunkFlexible are a fully
      // separate path for the 3 explicit modes, never the other way around.
      return lineCount === "auto" ? chunkWords(finalWords) : chunkWordsFlexible(finalWords, LINE_COUNT_BOUNDS[lineCount]);
    } catch (err) {
      lastError = err;
      console.error(`Transcription attempt ${attempt}/${MAX_ATTEMPTS} failed:`, describeError(err));
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }

  throw new Error(`Transcription failed after ${MAX_ATTEMPTS} attempts: ${describeError(lastError)}`);
}

// How many pieces of a long recording are sent to Whisper at once.
const CHUNK_CONCURRENCY = 3;

/**
 * Transcribes the given audio file into sentence-ish segments with real timestamps — for the
 * AI Clip Planner (see clipPlanner.ts), which needs readable, timestamped speech content to
 * reason about, not the short word-level bursts transcribeCaptions builds for on-screen captions.
 * A separate Whisper call from transcribeCaptions' (word-level) one — kept independent for now so
 * neither function's behavior depends on the other; worth merging into one "word"+"segment"
 * call once both are actually used together in the same job.
 *
 * Works however long the recording is: Whisper refuses an upload over 25 MB, so anything bigger is
 * split into pieces that fit and stitched back together with each piece's timestamps moved onto the
 * full recording's clock (see audioChunks.ts). A short video is a single request, exactly as
 * before. `durationSeconds` and `tmpDir` are only needed for that splitting.
 */
export async function transcribeSegments(
  audioPath: string,
  language: CaptionLanguage = "auto",
  durationSeconds?: number,
  tmpDir?: string,
  maxChunkBytes?: number
): Promise<TranscriptSegment[]> {
  if (durationSeconds == null || !tmpDir) return transcribeSegmentsOnce(audioPath, language);

  const chunks = await planAudioChunks(audioPath, durationSeconds, tmpDir, maxChunkBytes);
  if (chunks.length === 1) return transcribeSegmentsOnce(chunks[0].path, language);

  // A few pieces at a time: an hour-long piece takes a while, and a 3-hour stream is several of them.
  const perChunk: TranscriptSegment[][] = new Array(chunks.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < chunks.length) {
      const i = next++;
      try {
        // A piece with no speech in it (music, a break) is normal in a stream; only the whole
        // recording having none is an error, which is checked below.
        const segments = await transcribeSegmentsOnce(chunks[i].path, language, true);
        console.log(`[transcribe] chunk ${i + 1}/${chunks.length} (from ${Math.round(chunks[i].offsetSeconds)}s): ${segments.length} segment(s)`);
        perChunk[i] = segments.map((s) => ({ start: s.start + chunks[i].offsetSeconds, end: s.end + chunks[i].offsetSeconds, text: s.text }));
      } catch (err) {
        failed = true; // stop the other workers picking up more pieces of a job that is already lost
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker));

  const all = perChunk.flat();
  if (all.length === 0) throw new Error("Whisper returned no segments for any chunk of this audio");
  return all;
}

async function transcribeSegmentsOnce(
  audioPath: string,
  language: CaptionLanguage = "auto",
  allowEmpty = false
): Promise<TranscriptSegment[]> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  const { size: audioBytes } = await stat(audioPath);
  console.log(`Transcribing ${audioPath} for clip planning: ${audioBytes} bytes (language=${language})`);
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
        ...(language === "hinglish" ? { prompt: HINGLISH_PROMPT_HINT } : {}),
      });

      const segments = (response as unknown as { segments?: TranscriptSegment[] }).segments ?? [];
      console.log(`Segment transcription attempt ${attempt}: got ${segments.length} segment(s)`);
      if (segments.length === 0) {
        if (allowEmpty) return [];
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
