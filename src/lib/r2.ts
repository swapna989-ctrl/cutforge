import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Server-only: these credentials must never reach the browser bundle. R2 speaks the S3 API,
// so the plain AWS SDK works against it with a custom endpoint.
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  // R2 only reliably supports path-style addressing (endpoint/bucket/key) unless a custom
  // domain is configured — the SDK's virtual-hosted-style default (bucket.endpoint/key)
  // resolves to a host R2's CORS/routing doesn't recognize.
  forcePathStyle: true,
  // Newer SDK versions attach a CRC32 checksum to every request by default. R2 doesn't
  // handle that the same way S3 does for presigned URLs, which breaks the signature and
  // surfaces in the browser as an opaque CORS failure rather than the real cause.
  requestChecksumCalculation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

export function getUploadUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(s3, command, { expiresIn: 300 });
}

export function getDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn: 300 });
}
