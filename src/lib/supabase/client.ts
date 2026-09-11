import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client. Create a fresh one per call (cheap) rather than a module-level singleton, per Supabase's ssr package guidance. */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
