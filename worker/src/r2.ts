import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { pipeline as streamPipeline } from "node:stream/promises";
import { env } from "./env.js";

// R2 speaks the S3 API, so the plain AWS SDK works against it with a custom endpoint —
// no Cloudflare-specific SDK needed.
const s3 = new S3Client({
  region: "auto",
  endpoint: env.R2_ENDPOINT,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});

export async function downloadToFile(key: string, localPath: string): Promise<void> {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
  const body = res.Body;
  if (!body || !("pipe" in body)) throw new Error(`R2 object has no readable body: ${key}`);
  await streamPipeline(body as NodeJS.ReadableStream, createWriteStream(localPath));
}

export async function uploadFromFile(localPath: string, key: string, contentType: string): Promise<void> {
  const body = await readFile(localPath);
  await s3.send(new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key, Body: body, ContentType: contentType }));
}
