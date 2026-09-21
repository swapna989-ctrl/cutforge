// Whisper refuses any upload over 25 MB (confirmed against the real API: a 31 MB file came back
// "413 Maximum content size limit (26214400) exceeded"). Real speech audio at extractAudio's
// original settings measured about 108 kbps, so a file crossed that line at roughly 30 minutes --
// which is why a stream longer than that failed at transcription rather than being clipped. Audio
// for planning is now extracted smaller (extractPlanningAudio, 48 kbps), but size is not the only
// limit: a single 58-minute, 20 MB request was reset by the connection three times in a row
// (ECONNRESET while waiting for the answer), where the same audio in 8-minute pieces went through.
// So a long recording is split by running time as well as by size.
//
// This splits the audio into equal pieces, transcribes them a few at a time, and shifts each piece's
// timestamps back onto the full video's own clock. A video up to 15 minutes still goes through as a
// single request, exactly as before.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { splitAudio } from "./ffmpeg.js";

/** Comfortably under Whisper's 25 MiB limit, leaving room for the request itself and for a piece
 *  whose real size overshoots the estimate (audio is not perfectly constant bitrate). */
const MAX_CHUNK_BYTES = 20 * 1024 * 1024;

/** Recordings up to this long are one request; longer ones are cut into pieces of about
 *  MAX_CHUNK_SECONDS. 15 minutes is the longest single request this has been measured working on. */
const SINGLE_REQUEST_MAX_SECONDS = 15 * 60;
const MAX_CHUNK_SECONDS = 10 * 60;

/** Never cut a piece shorter than this: a tiny tail piece transcribes poorly on its own. */
const MIN_CHUNK_SECONDS = 60;

export type AudioChunk = {
  path: string;
  /** Where this chunk starts in the original audio -- add it to every timestamp the chunk returns. */
  offsetSeconds: number;
};

/**
 * How many equal pieces a recording should be sent in: enough that each fits the size limit
 * (worked out from the file's own real bitrate, so unusually dense or sparse audio is handled) and,
 * once it is longer than a single request is trusted with, that each runs about ten minutes.
 */
export function chunkCountFor(fileBytes: number, durationSeconds: number, maxChunkBytes = MAX_CHUNK_BYTES): number {
  if (!(durationSeconds > 0) || !(fileBytes > 0)) return 1;
  const bySize = Math.ceil(fileBytes / maxChunkBytes);
  const byTime = durationSeconds > SINGLE_REQUEST_MAX_SECONDS ? Math.ceil(durationSeconds / MAX_CHUNK_SECONDS) : 1;
  const mostThatStayLongEnough = Math.max(1, Math.floor(durationSeconds / MIN_CHUNK_SECONDS));
  return Math.min(Math.max(bySize, byTime), mostThatStayLongEnough);
}

/**
 * Splits `audioPath` into pieces Whisper will take (see chunkCountFor). Returns a single chunk (the
 * original file, no copying or re-encoding) when it needs no splitting, which is the common case.
 * `maxChunkBytes` exists so a test can force a split on a short recording.
 */
export async function planAudioChunks(
  audioPath: string,
  durationSeconds: number,
  tmpDir: string,
  maxChunkBytes = MAX_CHUNK_BYTES
): Promise<AudioChunk[]> {
  const { size } = await stat(audioPath);
  const count = chunkCountFor(size, durationSeconds, maxChunkBytes);
  if (count === 1) return [{ path: audioPath, offsetSeconds: 0 }];

  const chunkSeconds = durationSeconds / count;
  const chunks: AudioChunk[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * chunkSeconds;
    const path = join(tmpDir, `chunk-${i}.mp3`);
    // Copies the existing audio stream rather than re-encoding: fast, and the samples are untouched.
    await splitAudio(audioPath, start, Math.min(chunkSeconds, durationSeconds - start), path);
    chunks.push({ path, offsetSeconds: start });
  }
  console.log(
    `[transcribe] audio is ${(size / 1e6).toFixed(0)}MB (${Math.round(durationSeconds)}s) — split into ${count} pieces of about ${Math.round(chunkSeconds)}s`
  );
  return chunks;
}
