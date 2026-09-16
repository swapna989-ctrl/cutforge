import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// Service-role client — bypasses RLS entirely, same as worker/src/supabase.ts's own client. Only
// ever used from trusted server code (API routes handling a Razorpay order/webhook), never from
// anything that runs in the browser. `server-only` makes an accidental client-side import a build
// error instead of a leaked key.
//
// Built on first use, not at import: Next loads every route module while building, and a missing
// variable would otherwise fail the whole deploy instead of just the one request that needs it.
let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!client) {
    const url = env("NEXT_PUBLIC_SUPABASE_URL");
    const key = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Supabase service-role credentials are not configured");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
