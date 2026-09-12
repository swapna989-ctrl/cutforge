import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFile, writeFile } from "node:fs/promises";
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
  // Piping the raw stream to a file can resolve "successfully" even when the underlying
  // connection closes early, silently truncating the file (observed against R2 from Railway).
  // transformToByteArray() is the SDK's own full-body reader — it rejects on an incomplete
  // read instead of quietly finishing, and lets us verify the byte count against R2's own
  // ContentLength before trusting the file at all.
  const bytes = await res.Body.transformToByteArray();
  if (res.ContentLength !== undefined && bytes.length !== res.ContentLength) {
    throw new Error(`Downloaded ${bytes.length} bytes but R2 reports ${res.ContentLength} for ${key}`);
  }
  await writeFile(localPath, bytes);
}

export async function uploadFromFile(localPath: string, key: string, contentType: string): Promise<void> {
  const body = await readFile(localPath);
  await s3.send(new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key, Body: body, ContentType: contentType }));
}
