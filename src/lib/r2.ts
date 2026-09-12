import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// A dashboard paste landing with a trailing newline has broken this exact config twice already
// (a mangled R2_ENDPOINT, then an OpenAI key that made its auth header technically invalid) —
// trimming can't break a value that was already correct, so there's no reason to skip it.
function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

// Server-only: these credentials must never reach the browser bundle. R2 speaks the S3 API,
// so the plain AWS SDK works against it with a custom endpoint.
const s3 = new S3Client({
  region: "auto",
  endpoint: env("R2_ENDPOINT"),
  // R2 only reliably supports path-style addressing (endpoint/bucket/key) unless a custom
  // domain is configured — the SDK's virtual-hosted-style default (bucket.endpoint/key)
  // resolves to a host R2's CORS/routing doesn't recognize.
  forcePathStyle: true,
  // Newer SDK versions attach a CRC32 checksum to every request by default. R2 doesn't
  // handle that the same way S3 does for presigned URLs, which breaks the signature and
  // surfaces in the browser as an opaque CORS failure rather than the real cause.
  requestChecksumCalculation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
  },
});

const BUCKET = env("R2_BUCKET_NAME");

export function getUploadUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(s3, command, { expiresIn: 300 });
}

/**
 * Builds a `Content-Disposition: attachment` value for the given filename. This is what
 * actually forces a save-to-disk prompt across browsers — the HTML `download` attribute on an
 * `<a>` tag is only reliably honored for same-origin URLs, and a presigned R2 URL is always
 * cross-origin, so without this header (S3/R2's `response-content-disposition` param) browsers —
 * Mobile Safari especially — just navigate to and preview the video instead of downloading it.
 * Includes both a plain ASCII fallback and an RFC 5987 UTF-8 form so non-ASCII project names
 * degrade gracefully instead of producing a malformed header.
 */
function contentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "cutforge-master.mp4";
  const utf8Encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}

export function getDownloadUrl(key: string, filename: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: contentDisposition(filename),
    ResponseContentType: "video/mp4",
  });
  return getSignedUrl(s3, command, { expiresIn: 300 });
}
