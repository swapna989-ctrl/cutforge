import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";
import type { CaptionFont, CaptionPosition, CaptionStyle } from "./ffmpeg.js";
import type { CaptionLanguage, CaptionLineCount } from "./transcribe.js";
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
  caption_font: CaptionFont;
  caption_position: CaptionPosition;
  caption_language: CaptionLanguage;
  caption_line_count: CaptionLineCount;
  clip_length: ClipLength;
  // The dead-air-trimmed source this project's shorts were cut from — persisted (unlike every
  // other intermediate file in worker/src/pipeline.ts's tmpDir) specifically so a short can be
  // re-edited later. Null for any project processed before this column existed.
  trimmed_key: string | null;
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

/** Fetches one project row as-is, no status filtering/claiming — used by regenerateShort to read
 *  the parent project's current defaults/trimmed_key/watermark for a short being re-edited. */
export async function getProject(id: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
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

/**
 * How many credits this user could spend right now -- the same sum the frontend shows
 * (billing.tsx's availableCredits): this cycle's plan allowance (only while a plan is active), plus
 * paid, plus free. Read-only and advisory: used to refuse an obviously unaffordable link *before*
 * downloading it. The real, authoritative charge is still chargeProjectCredits, which runs later
 * against the measured duration.
 */
export async function getAvailableCredits(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("billing")
    .select("free_credits, paid_credits, plan_tier, plan_credits")
    .eq("user_id", userId)
    .single();
  if (error) throw new Error(error.message);
  return (data.plan_tier !== "none" ? data.plan_credits : 0) + data.paid_credits + data.free_credits;
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
  // 'regenerating' is this row's own version of ProjectRow.pipeline_status's 'queued' — set by
  // the frontend, claimed and moved onward only by claimNextShortRegenerate below.
  status: "pending" | "processing" | "ready" | "failed" | "regenerating";
  output_key: string | null;
  error_message: string | null;
  created_at: string;
  // Per-short overrides — null means "inherit the parent project's current default" (see
  // regenerate.ts's resolveSetting), same nullable-override pattern as CaptionPresetSpec's
  // fontOverride in ffmpeg.ts. Editing one short never touches its project or its siblings.
  caption_style: CaptionStyle | null;
  caption_font: CaptionFont | null;
  caption_position: CaptionPosition | null;
  caption_language: CaptionLanguage | null;
  caption_line_count: CaptionLineCount | null;
  ratio: "9:16" | "16:9" | "1:1" | null;
  // A manual crop center as a fraction (0-1) of the *source* frame — same convention
  // detectFaceCenterFraction returns in faceCrop.ts. Null means "keep auto face-detection".
  crop_x: number | null;
  crop_y: number | null;
  // Set once the worker has extracted an uncropped representative frame for the crop tool to
  // show — '__pending__' is the sentinel the frontend writes to request one (see
  // claimNextPreviewFrame below).
  preview_frame_key: string | null;
  // A real gallery-thumbnail frame from the short's own FINAL rendered output (captions/crop/
  // watermark already applied) — mobile Safari/WebKit doesn't reliably self-render a <video>
  // element's first frame from preload="metadata" alone, so the frontend uses this as a real
  // <video poster> instead of relying on that. Set once per successful render; a failed
  // extraction leaves this untouched rather than nulling out a still-good earlier thumbnail.
  thumbnail_key: string | null;
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

/** The sentinel the frontend writes to preview_frame_key to request one — see
 *  claimNextPreviewFrame below. Shared here so neither side can typo it independently. */
export const PREVIEW_FRAME_PENDING = "__pending__";

/** Not a true atomic claim (same accepted single-worker-v1 limitation as claimNextJob) — polls
 *  for a short whose crop tool has been opened but has no preview frame yet. */
export async function claimNextPreviewFrame(): Promise<ShortRow | null> {
  const { data, error } = await supabase
    .from("shorts")
    .select("*")
    .eq("preview_frame_key", PREVIEW_FRAME_PENDING)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Same claim pattern as claimNextJob (update-with-status-guard as the race check), just for one
 *  short instead of one project — set by the frontend's Regenerate button, only ever moved onward
 *  by this function. */
export async function claimNextShortRegenerate(): Promise<ShortRow | null> {
  const { data, error } = await supabase
    .from("shorts")
    .select("*")
    .eq("status", "regenerating")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { error: claimError } = await supabase
    .from("shorts")
    .update({ status: "processing" })
    .eq("id", data.id)
    .eq("status", "regenerating");
  if (claimError) throw claimError;

  return { ...data, status: "processing" };
}

/**
 * The real charge for regenerating one short (see charge_short_regenerate_credit in
 * supabase/migrations/0020_short_editing.sql), called right before the metered Whisper/render
 * calls that actually cost money run — same "charge before the expensive work starts" ordering as
 * chargeProjectCredits. Throws with a message starting "INSUFFICIENT_CREDITS: " if the owner
 * can't afford it.
 */
export async function chargeShortRegenerateCredit(shortId: string): Promise<void> {
  const { error } = await supabase.rpc("charge_short_regenerate_credit", { p_short_id: shortId }).single();
  if (error) throw new Error(error.message);
}
