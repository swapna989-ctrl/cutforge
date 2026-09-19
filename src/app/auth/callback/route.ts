import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { friendlyAuthMessage } from "@/lib/authErrors";

/** Only allow same-app redirect targets — never forward a query param straight into a redirect. */
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/dashboard";
}

// Behind Railway's proxy the app listens on an internal port, and `new URL(request.url).origin`
// reports that internal address (confirmed against production: this route was answering with
// `location: https://localhost:8080/...`). Every post-login redirect built from it sent real users
// to a dead localhost page *after* the session had already been created -- the sign-in succeeded
// (Supabase logs showed it, and going back landed them signed in), then the browser was sent
// somewhere unreachable. So production uses the real domain; local dev keeps the request's own
// origin so http://localhost:3000 sign-in testing still works.
const PRODUCTION_ORIGIN = "https://www.flovuraai.com";

function publicOrigin(requestUrl: string): string {
  return process.env.NODE_ENV === "production" ? PRODUCTION_ORIGIN : new URL(requestUrl).origin;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = publicOrigin(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  // Supabase sends errors here directly (expired/used links, a cancelled Google consent screen)
  // without a `code` — surface the real reason on /login instead of failing silently.
  const oauthError = searchParams.get("error_description") || searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(friendlyAuthMessage(oauthError))}`);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(friendlyAuthMessage(error.message))}`);
  }

  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("This link is invalid or has expired.")}`);
}
