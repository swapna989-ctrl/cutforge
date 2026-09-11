import { createClient } from "@/lib/supabase/client";
import type { PipelineStatus, Ratio } from "@/lib/pipeline";

export type Project = {
  id: string;
  name: string;
  ratio: Ratio;
  pipelineStatus: PipelineStatus;
  progress: number;
  createdAt: string;
  status: "ready" | "draft";
};

type ProjectRow = {
  id: string;
  name: string;
  ratio: string;
  pipeline_status: string;
  progress: number;
  created_at: string;
};

function mapRow(row: ProjectRow): Project {
  const pipelineStatus = row.pipeline_status as PipelineStatus;
  return {
    id: row.id,
    name: row.name,
    ratio: row.ratio as Ratio,
    pipelineStatus,
    progress: row.progress,
    createdAt: row.created_at.slice(0, 10),
    status: pipelineStatus === "ready" ? "ready" : "draft",
  };
}

/** Lists the signed-in user's projects, most recent first. RLS scopes this to their own rows. */
export async function listProjects(): Promise<Project[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data as ProjectRow[]).map(mapRow);
}

export async function getProject(id: string | null): Promise<Project | null> {
  if (!id) return null;
  const supabase = createClient();
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as ProjectRow) : null;
}

export async function createProject(input: { name: string; ratio: Ratio; pipelineStatus: PipelineStatus; progress: number }): Promise<Project> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: input.name,
      ratio: input.ratio,
      pipeline_status: input.pipelineStatus,
      progress: input.progress,
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data as ProjectRow);
}

export async function updateProject(
  id: string,
  patch: Partial<{ pipelineStatus: PipelineStatus; progress: number; ratio: Ratio }>
): Promise<void> {
  const supabase = createClient();
  const update: Record<string, unknown> = {};
  if (patch.pipelineStatus !== undefined) update.pipeline_status = patch.pipelineStatus;
  if (patch.progress !== undefined) update.progress = patch.progress;
  if (patch.ratio !== undefined) update.ratio = patch.ratio;
  const { error } = await supabase.from("projects").update(update).eq("id", id);
  if (error) throw error;
}

export async function deleteProject(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}
