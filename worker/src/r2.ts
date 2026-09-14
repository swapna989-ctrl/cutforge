import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { env } from "./env.js";

// R2 speaks the S3 API, so the plain AWS SDK works against it with a custom endpoint —
// no Cloudflare-specific SDK needed.
const s3 = new S3Client({
  region: "auto",
  endpoint: env.R2_ENDPOINT,
  // R2 only reliably supports path-style addressing (endpoint/bucket/key) unless a custom
  // domain is configured — the SDK's virtual-hosted-style default (bucket.endpoint/key)
  // resolves to a host R2 doesn't recognize.
  forcePathStyle: true,
  // Newer SDK versions attach a CRC32 checksum to every request by default, which R2
  // doesn't handle the same way S3 does — avoid it entirely, not just on presigned URLs.
  requestChecksumCalculation: "WHEN_REQUIRED",
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});

export async function downloadToFile(key: string, localPath: string): Promise<void> {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
  if (!res.Body) throw new Error(`R2 object has no readable body: ${key}`);
  // Streamed straight to disk instead of buffered fully in memory first (transformToByteArray())
  // — a large source video (a multi-GB Twitch VOD confirmed to have OOM-killed this worker, whose
  // container has nowhere near enough RAM to hold one in full) has to go through disk either way,
  // so there's no reason to also hold the whole thing in memory on the way there. Still verified
  // against R2's own ContentLength afterward via a real stat (not just trusting a clean
  // stream-end) since a naive pipe can resolve "successfully" even when the underlying connection
  // closed early and silently truncated the file — the exact failure mode transformToByteArray
  // was originally added to catch, observed against R2 from Railway.
  await pipeline(res.Body as NodeJS.ReadableStream, createWriteStream(localPath));
  if (res.ContentLength !== undefined) {
    const { size } = await stat(localPath);
    if (size !== res.ContentLength) {
      throw new Error(`Downloaded ${size} bytes but R2 reports ${res.ContentLength} for ${key}`);
    }
  }
}

export async function uploadFromFile(localPath: string, key: string, contentType: string): Promise<void> {
  // Streamed from disk instead of reading the whole file into memory first (readFile()) — same
  // OOM concern as downloadToFile above, and this exact path re-uploads the same large files
  // right after downloading them (see pipeline.ts's link-ingestion branch), so it's just as
  // likely to be holding a multi-GB buffer at the same time as ffmpeg/other work is using memory.
  // ContentLength is passed explicitly (from a real stat, not guessed) since S3-compatible APIs
  // generally want it up front for a streamed, non-chunked body.
  const { size } = await stat(localPath);
  await s3.send(
    new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key, Body: createReadStream(localPath), ContentType: contentType, ContentLength: size })
  );
}
