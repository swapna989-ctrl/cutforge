import OpenAI from "openai";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { env } from "./env.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 4, timeout: 120000 });

type Segment = { start: number; end: number; text: string };

/**
 * The OpenAI SDK collapses every network-layer failure into a bare "Connection error.", which
 * says nothing about whether it was DNS, a refused connection, a TLS failure or a timeout.
 * The real reason lives on `cause` (and the errno fields underneath it).
 */
function describeError(err: unknown): string {
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

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function segmentsToSrt(segments: Segment[]): string {
  return segments
    .map((seg, i) => `${i + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.text.trim()}\n`)
    .join("\n");
}

/**
 * Transcribes the given audio file and writes an .srt caption file next to it.
 * whisper-1 is the only current model that supports timestamp_granularities, which is what
 * makes accurately-synced captions possible — the newer/cheaper transcribe models don't.
 */
export async function transcribeToSrt(audioPath: string, srtOutputPath: string): Promise<void> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await openai.audio.transcriptions.create({
        // Re-created per attempt: a stream consumed by a failed request can't be replayed.
        file: createReadStream(audioPath),
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      });

      const segments = (response as unknown as { segments?: Segment[] }).segments ?? [];
      await writeFile(srtOutputPath, segmentsToSrt(segments), "utf-8");
      return;
    } catch (err) {
      lastError = err;
      console.error(`Transcription attempt ${attempt}/${MAX_ATTEMPTS} failed:`, describeError(err));
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }

  throw new Error(`Transcription failed after ${MAX_ATTEMPTS} attempts: ${describeError(lastError)}`);
}
