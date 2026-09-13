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
  statusMessage: string | null;
  errorMessage: string | null;
  outputKey: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
  ratio: string;
  pipeline_status: string;
  progress: number;
  created_at: string;
  status_message: string | null;
  error_message: string | null;
  output_key: string | null;
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
    statusMessage: row.status_message,
    errorMessage: row.error_message,
    outputKey: row.output_key,
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

export async function createProject(input: {
  name: string;
  ratio: Ratio;
  pipelineStatus: PipelineStatus;
  progress: number;
  sourceKey?: string;
  /** Captured once, at upload time, from the user's current billing status — this is what the
   *  worker actually burns into (or omits from) the real output file. */
  watermark: boolean;
}): Promise<Project> {
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
      source_key: input.sourceKey ?? null,
      watermark: input.watermark,
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

export type ProjectClip = {
  id: string;
  projectId: string;
  position: number;
  sourceKey: string;
  fileName: string;
  duration: number | null;
  createdAt: string;
};

type ProjectClipRow = {
  id: string;
  project_id: string;
  position: number;
  source_key: string;
  file_name: string;
  duration: number | null;
  created_at: string;
};

function mapClipRow(row: ProjectClipRow): ProjectClip {
  return {
    id: row.id,
    projectId: row.project_id,
    position: row.position,
    sourceKey: row.source_key,
    fileName: row.file_name,
    duration: row.duration,
    createdAt: row.created_at,
  };
}

/**
 * Creates one project_clips row. No user_id to attach here (the table has none) — ownership is
 * enforced entirely by RLS, which checks the parent project's user_id via a join, so this insert
 * only succeeds when projectId already belongs to the signed-in user.
 */
export async function createProjectClip(input: {
  projectId: string;
  position: number;
  sourceKey: string;
  fileName: string;
  duration?: number | null;
}): Promise<ProjectClip> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("project_clips")
    .insert({
      project_id: input.projectId,
      position: input.position,
      source_key: input.sourceKey,
      file_name: input.fileName,
      duration: input.duration ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapClipRow(data as ProjectClipRow);
}
