import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shared by the client-verify route (signing `orderId|paymentId` with the key secret) and the
 * webhook route (signing the raw request body with the separate webhook secret) — different
 * inputs and secrets, same HMAC-SHA256-then-timing-safe-compare shape. Centralized because this
 * is the one check that actually decides whether to grant real money's worth of credits; a
 * length check before `timingSafeEqual` is required since it throws on mismatched buffer lengths
 * rather than returning false.
 */
export function verifyHmacSignature(payload: string, secret: string, signatureHex: string): boolean {
  // An unset variable reads as "", and HMAC with an empty key still produces a signature, one anyone
  // can compute. A missing secret must mean "reject everything", never "accept a signature made
  // with no secret".
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf-8");
  const actualBuf = Buffer.from(signatureHex, "utf-8");
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}
