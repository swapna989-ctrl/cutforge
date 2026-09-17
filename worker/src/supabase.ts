import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";
import type { CaptionStyle } from "./ffmpeg.js";
import type { CaptionLanguage } from "./transcribe.js";
import type { ClipLength } from "./clipPlanner.js";

// The service role key bypasses RLS entirely — this process is trusted backend code, not a
// user's browser session, so it can see and update every user's project row. Never let this
// key anywhere near the Next.js app's client bundle.
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  ratio: "9:16" | "16:9" | "1:1";
  pipeline_status: "idle" | "ingesting" | "queued" | "synthesizing" | "ready" | "failed";
  progress: number;
  source_key: string | null;
  // Set when the project came from a pasted link instead of an upload — the worker downloads
  // from here and populates source_key itself; from that point on it's indistinguishable from
  // an uploaded project.
  source_url: string | null;
  output_key: string | null;
  status_message: string | null;
  error_message: string | null;
  watermark: boolean;
  caption_style: CaptionStyle;
  caption_language: CaptionLanguage;
  clip_length: ClipLength;
};

export async function claimNextJob(): Promise<ProjectRow | null> {
  // Not a true atomic claim (fine for a single-worker v1 — revisit with a proper
  // SELECT ... FOR UPDATE SKIP LOCKED RPC before running more than one worker at once).
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("pipeline_status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { error: claimError } = await supabase
    .from("projects")
    .update({ pipeline_status: "synthesizing", progress: 0, status_message: "Starting up…" })
    .eq("id", data.id)
    .eq("pipeline_status", "queued"); // only claim if still queued (basic race guard)
  if (claimError) throw claimError;

  return { ...data, pipeline_status: "synthesizing", progress: 0 };
}

export async function updateJob(id: string, patch: Partial<ProjectRow>): Promise<void> {
  const { error } = await supabase.from("projects").update(patch).eq("id", id);
  if (error) throw error;
}

/**
 * The real charge for this project: called once processJob knows the source's actual duration
 * (see charge_project_credits in supabase/migrations/0009_duration_scaled_credits.sql), before
 * any of the metered Whisper/LLM calls that actually cost money run. Throws — with a message
 * starting "INSUFFICIENT_CREDITS: " — if the owner can't afford it, which the caller lets
 * propagate up to processJob's normal failure handling rather than ever starting those calls.
 * Idempotent server-side, so a resumed/retried job is never charged twice.
 */
export async function chargeProjectCredits(
  projectId: string,
  durationSeconds: number
): Promise<{ chargedCredits: number; watermarkFree: boolean }> {
  const { data, error } = await supabase
    .rpc("charge_project_credits", { p_project_id: projectId, p_duration_seconds: Math.round(durationSeconds) })
    .single();
  if (error) throw new Error(error.message);
  const row = data as { charged_credits: number; watermark_free: boolean };
  return { chargedCredits: row.charged_credits, watermarkFree: row.watermark_free };
}

export type ProjectClipRow = {
  id: string;
  project_id: string;
  position: number;
  source_key: string;
  file_name: string;
  duration: number | null;
  created_at: string;
};

// Ordered by position: multi-clip projects are stitched together in exactly this order. A
// project with no rows here (every project today) just gets an empty array back.
export async function getProjectClips(projectId: string): Promise<ProjectClipRow[]> {
  const { data, error } = await supabase
    .from("project_clips")
    .select("*")
    .eq("project_id", projectId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type ShortRow = {
  id: string;
  project_id: string;
  position: number;
  source_start_seconds: number;
  source_end_seconds: number;
  hook: string;
  caption: string;
  // LLM-estimated, not measured (no posted-clip performance data exists yet) — see
  // clipPlanner.ts's ClipCandidate.viralScore for what it actually represents.
  viral_score: number | null;
  status: "pending" | "processing" | "ready" | "failed";
  output_key: string | null;
  error_message: string | null;
  created_at: string;
};

/** Inserts one `pending` short row per planned candidate, in position order — done up front
 *  (before any rendering starts) so the plan itself is visible/durable even if rendering fails
 *  partway through. */
export async function createShorts(
  projectId: string,
  candidates: { startTime: number; endTime: number; hook: string; caption: string; viralScore: number }[]
): Promise<ShortRow[]> {
  const rows = candidates.map((c, i) => ({
    project_id: projectId,
    position: i,
    source_start_seconds: c.startTime,
    source_end_seconds: c.endTime,
    hook: c.hook,
    caption: c.caption,
    viral_score: c.viralScore,
    status: "pending" as const,
  }));
  const { data, error } = await supabase.from("shorts").insert(rows).select("*");
  if (error) throw error;
  return data ?? [];
}

export async function updateShort(id: string, patch: Partial<ShortRow>): Promise<void> {
  const { error } = await supabase.from("shorts").update(patch).eq("id", id);
  if (error) throw error;
}
