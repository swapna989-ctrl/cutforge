/** Trims trailing whitespace/newlines from an env var — a dashboard paste with a trailing
 *  newline has broken real config in this project before (see r2.ts's own history: a mangled
 *  R2_ENDPOINT, then an OpenAI key with an invalid auth header), so every secret read for the
 *  new Razorpay routes goes through this rather than raw `process.env`. */
export function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}
