/**
 * Every auth method in auth.tsx returns Supabase GoTrue's raw error.message untouched — fine for
 * a few ("Invalid login credentials" is already clear), but PKCE/flow-state errors in particular
 * ("invalid flow state, no valid flow state found", "code verifier could not be found") are pure
 * internals no user should ever have to read. Pattern-matched rather than exact-string-matched
 * since GoTrue's exact wording can shift across Supabase versions; falls through to the original
 * message for anything not recognized below, since most of GoTrue's own text is already
 * reasonably plain English — this only intercepts the genuinely internal-sounding cases.
 */
export function friendlyAuthMessage(raw: string): string {
  const lower = raw.toLowerCase();

  if (lower.includes("flow state") || lower.includes("code verifier") || lower.includes("code challenge")) {
    return "Your sign-in link expired or was already used — please try signing in again.";
  }
  if (lower.includes("email link") && (lower.includes("invalid") || lower.includes("expired"))) {
    return "This link has expired or was already used — please request a new one.";
  }
  if (lower.includes("user already registered") || lower.includes("already been registered")) {
    return "An account with this email already exists — try logging in instead.";
  }
  if (lower.includes("email not confirmed")) {
    return "Please confirm your email before signing in — check your inbox.";
  }
  if (lower.startsWith("for security purposes")) {
    return "Please wait a moment before trying again.";
  }
  if (lower.includes("rate limit")) {
    return "Too many attempts — please wait a moment and try again.";
  }
  // Google's own OAuth error code when the user cancels/denies the consent screen, not a GoTrue
  // message — reaches the same place (auth/callback/route.ts), so it's handled here too.
  if (lower.includes("access_denied")) {
    return "Sign-in was cancelled.";
  }

  return raw;
}
