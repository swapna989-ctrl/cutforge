import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

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
  ratio: "9:16" | "16:9";
  pipeline_status: "idle" | "ingesting" | "queued" | "synthesizing" | "ready" | "failed";
  progress: number;
  source_key: string | null;
  output_key: string | null;
  status_message: string | null;
  error_message: string | null;
  watermark: boolean;
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
