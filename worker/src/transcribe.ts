import OpenAI from "openai";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { env } from "./env.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

type Segment = { start: number; end: number; text: string };

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
  const response = await openai.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const segments = (response as unknown as { segments?: Segment[] }).segments ?? [];
  const srt = segmentsToSrt(segments);
  await writeFile(srtOutputPath, srt, "utf-8");
}
