import { createClient } from "@/lib/supabase/client";
import type { PipelineStatus, Ratio, CaptionStyle, CaptionFont, CaptionPosition, CaptionLanguage, CaptionLineCount, ClipLength } from "@/lib/pipeline";

export type Project = {
  id: string;
  name: string;
  ratio: Ratio;
  captionStyle: CaptionStyle;
  captionFont: CaptionFont;
  captionPosition: CaptionPosition;
  captionLanguage: CaptionLanguage;
  captionLineCount: CaptionLineCount;
  clipLength: ClipLength;
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
  caption_style: string;
  caption_font: string;
  caption_position: string;
  caption_language: string;
  caption_line_count: string;
  clip_length: string;
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
    captionStyle: row.caption_style as CaptionStyle,
    captionFont: row.caption_font as CaptionFont,
    captionPosition: row.caption_position as CaptionPosition,
    captionLanguage: row.caption_language as CaptionLanguage,
    captionLineCount: row.caption_line_count as CaptionLineCount,
    clipLength: row.clip_length as ClipLength,
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
  /** Which caption preset the worker burns in — see worker/src/ffmpeg.ts's CAPTION_PRESETS. */
  captionStyle: CaptionStyle;
  /** Which font family the worker burns in — an independent dimension from captionStyle, see
   *  worker/src/ffmpeg.ts's FONT_DISPLAY_NAMES. */
  captionFont: CaptionFont;
  /** Where captions sit vertically — see worker/src/ffmpeg.ts's CAPTION_POSITION_SPECS. */
  captionPosition: CaptionPosition;
  /** Whether to bias transcription toward Romanized Hindi — see worker/src/transcribe.ts's
   *  HINGLISH_PROMPT_HINT. Best-effort, opt-in. */
  captionLanguage: CaptionLanguage;
  /** How aggressively captions are chunked/wrapped — see worker/src/transcribe.ts's
   *  LINE_COUNT_BOUNDS, which is what actually enforces it. */
  captionLineCount: CaptionLineCount;
  /** Which duration range the AI clip planner targets — see worker/src/clipPlanner.ts's
   *  CLIP_LENGTH_BOUNDS, which is what actually enforces it. */
  clipLength: ClipLength;
  pipelineStatus: PipelineStatus;
  progress: number;
  sourceKey?: string;
  /** A YouTube/Twitch (or other yt-dlp-supported) link instead of an uploaded file — the
   *  worker downloads it and fills in source_key itself before processing starts. */
  sourceUrl?: string;
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
      caption_style: input.captionStyle,
      caption_font: input.captionFont,
      caption_position: input.captionPosition,
      caption_language: input.captionLanguage,
      caption_line_count: input.captionLineCount,
      clip_length: input.clipLength,
      pipeline_status: input.pipelineStatus,
      progress: input.progress,
      source_key: input.sourceKey ?? null,
      source_url: input.sourceUrl ?? null,
      watermark: input.watermark,
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data as ProjectRow);
}

export async function updateProject(
  id: string,
  patch: Partial<{
    pipelineStatus: PipelineStatus;
    progress: number;
    ratio: Ratio;
    sourceKey: string;
    captionStyle: CaptionStyle;
    captionFont: CaptionFont;
    captionPosition: CaptionPosition;
    captionLanguage: CaptionLanguage;
    captionLineCount: CaptionLineCount;
    clipLength: ClipLength;
  }>
): Promise<void> {
  const supabase = createClient();
  const update: Record<string, unknown> = {};
  if (patch.pipelineStatus !== undefined) update.pipeline_status = patch.pipelineStatus;
  if (patch.progress !== undefined) update.progress = patch.progress;
  if (patch.ratio !== undefined) update.ratio = patch.ratio;
  if (patch.sourceKey !== undefined) update.source_key = patch.sourceKey;
  if (patch.captionStyle !== undefined) update.caption_style = patch.captionStyle;
  if (patch.captionFont !== undefined) update.caption_font = patch.captionFont;
  if (patch.captionPosition !== undefined) update.caption_position = patch.captionPosition;
  if (patch.captionLanguage !== undefined) update.caption_language = patch.captionLanguage;
  if (patch.captionLineCount !== undefined) update.caption_line_count = patch.captionLineCount;
  if (patch.clipLength !== undefined) update.clip_length = patch.clipLength;
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

/** Lists a project's clips in position order. RLS scopes this via the parent project's user_id. */
export async function listProjectClips(projectId: string): Promise<ProjectClip[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("project_clips")
    .select("*")
    .eq("project_id", projectId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data as ProjectClipRow[]).map(mapClipRow);
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

/** Patches one project_clips row — used for renumbering after a removal and for Replace. */
export async function updateProjectClip(
  id: string,
  patch: Partial<{ position: number; sourceKey: string; fileName: string; duration: number | null }>
): Promise<void> {
  const supabase = createClient();
  const update: Record<string, unknown> = {};
  if (patch.position !== undefined) update.position = patch.position;
  if (patch.sourceKey !== undefined) update.source_key = patch.sourceKey;
  if (patch.fileName !== undefined) update.file_name = patch.fileName;
  if (patch.duration !== undefined) update.duration = patch.duration;
  const { error } = await supabase.from("project_clips").update(update).eq("id", id);
  if (error) throw error;
}

export async function deleteProjectClip(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("project_clips").delete().eq("id", id);
  if (error) throw error;
}

export type Short = {
  id: string;
  projectId: string;
  position: number;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  hook: string;
  caption: string;
  /** LLM-estimated, not measured — see worker/src/clipPlanner.ts. Null for shorts planned
   *  before viral scoring existed. */
  viralScore: number | null;
  /** 'regenerating' is this short's own version of Project.pipelineStatus's 'queued' — set by
   *  the Edit/Crop page's Regenerate button, moved onward only by the worker's own poll loop. */
  status: "pending" | "processing" | "ready" | "failed" | "regenerating";
  outputKey: string | null;
  errorMessage: string | null;
  createdAt: string;
  /** Per-short overrides — null means "inherit the parent project's current default", same
   *  nullable-override pattern as CaptionPresetSpec's fontOverride in worker/src/ffmpeg.ts.
   *  Editing one short never touches its project or its siblings. */
  captionStyle: CaptionStyle | null;
  captionFont: CaptionFont | null;
  captionPosition: CaptionPosition | null;
  captionLanguage: CaptionLanguage | null;
  captionLineCount: CaptionLineCount | null;
  ratio: Ratio | null;
  /** A manual crop center as a fraction (0-1) of the *source* frame — null means "keep auto
   *  face-detection", today's unchanged behavior. */
  cropX: number | null;
  cropY: number | null;
  /** Set once the worker has extracted an uncropped representative frame for the crop tool. */
  previewFrameKey: string | null;
};

type ShortRow = {
  id: string;
  project_id: string;
  position: number;
  source_start_seconds: number;
  source_end_seconds: number;
  hook: string;
  caption: string;
  viral_score: number | null;
  status: string;
  output_key: string | null;
  error_message: string | null;
  created_at: string;
  caption_style: string | null;
  caption_font: string | null;
  caption_position: string | null;
  caption_language: string | null;
  caption_line_count: string | null;
  ratio: string | null;
  crop_x: number | null;
  crop_y: number | null;
  preview_frame_key: string | null;
};

function mapShortRow(row: ShortRow): Short {
  return {
    id: row.id,
    projectId: row.project_id,
    position: row.position,
    sourceStartSeconds: row.source_start_seconds,
    sourceEndSeconds: row.source_end_seconds,
    hook: row.hook,
    caption: row.caption,
    viralScore: row.viral_score,
    status: row.status as Short["status"],
    outputKey: row.output_key,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    captionStyle: row.caption_style as CaptionStyle | null,
    captionFont: row.caption_font as CaptionFont | null,
    captionPosition: row.caption_position as CaptionPosition | null,
    captionLanguage: row.caption_language as CaptionLanguage | null,
    captionLineCount: row.caption_line_count as CaptionLineCount | null,
    ratio: row.ratio as Ratio | null,
    cropX: row.crop_x,
    cropY: row.crop_y,
    previewFrameKey: row.preview_frame_key,
  };
}

/** Lists a project's AI-generated shorts in position order. RLS scopes this via the parent
 *  project's user_id, same join pattern as project_clips. */
export async function listShorts(projectId: string): Promise<Short[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shorts")
    .select("*")
    .eq("project_id", projectId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data as ShortRow[]).map(mapShortRow);
}

/** Fetches one short by id — used by the Edit/Crop page, which is opened by id from a link
 *  rather than already having the short in hand from a list. RLS scopes this via the parent
 *  project's user_id, same join pattern as listShorts. */
export async function getShort(id: string): Promise<Short | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from("shorts").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapShortRow(data as ShortRow) : null;
}

/** Patches one short — used by the Edit/Crop page to save per-short overrides and, on Regenerate,
 *  to flip status to 'regenerating' (only the worker's poll loop moves it on from there). */
export async function updateShort(
  id: string,
  patch: Partial<{
    captionStyle: CaptionStyle | null;
    captionFont: CaptionFont | null;
    captionPosition: CaptionPosition | null;
    captionLanguage: CaptionLanguage | null;
    captionLineCount: CaptionLineCount | null;
    ratio: Ratio | null;
    cropX: number | null;
    cropY: number | null;
    previewFrameKey: string | null;
    status: Short["status"];
  }>
): Promise<void> {
  const supabase = createClient();
  const update: Record<string, unknown> = {};
  if (patch.captionStyle !== undefined) update.caption_style = patch.captionStyle;
  if (patch.captionFont !== undefined) update.caption_font = patch.captionFont;
  if (patch.captionPosition !== undefined) update.caption_position = patch.captionPosition;
  if (patch.captionLanguage !== undefined) update.caption_language = patch.captionLanguage;
  if (patch.captionLineCount !== undefined) update.caption_line_count = patch.captionLineCount;
  if (patch.ratio !== undefined) update.ratio = patch.ratio;
  if (patch.cropX !== undefined) update.crop_x = patch.cropX;
  if (patch.cropY !== undefined) update.crop_y = patch.cropY;
  if (patch.previewFrameKey !== undefined) update.preview_frame_key = patch.previewFrameKey;
  if (patch.status !== undefined) update.status = patch.status;
  const { error } = await supabase.from("shorts").update(update).eq("id", id);
  if (error) throw error;
}

export async function deleteShort(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("shorts").delete().eq("id", id);
  if (error) throw error;
}
