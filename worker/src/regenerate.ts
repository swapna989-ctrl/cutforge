import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { downloadToFile, uploadFromFile } from "./r2.js";
import { extractClipRange, extractFrame, getDuration, getVideoDimensions, STANDARD_LONG_EDGE, HD_LONG_EDGE } from "./ffmpeg.js";
import { renderShort, clipSourceKey } from "./render.js";
import { getProject, updateShort, chargeShortRegenerateCredit, type ProjectRow, type ShortRow } from "./supabase.js";
import { toUserMessage, UserFacingError } from "./errors.js";

/** null on the short means "inherit the parent project's current default" — same nullable-override
 *  pattern as CaptionPresetSpec's fontOverride in ffmpeg.ts. */
function resolve<T>(shortValue: T | null, projectValue: T): T {
  return shortValue ?? projectValue;
}

/**
 * A project made before shorts were cut one moment at a time has ONE saved file: the whole video with
 * its dead air already removed (`trimmed_key`), and each short's start/end are positions in that file.
 * Every newer project has none, and instead each short has its own small saved footage (see
 * render.ts's clipSourceKey).
 */
function usesWholeTrimmedFile(project: ProjectRow): boolean {
  return Boolean(project.trimmed_key);
}

/** Fetches this short's own saved footage, or explains that it isn't there. */
async function downloadClipSource(project: ProjectRow, short: ShortRow, localPath: string): Promise<void> {
  try {
    await downloadToFile(clipSourceKey(project.user_id, short.id), localPath);
  } catch (err) {
    console.error(`No saved footage for short ${short.id}:`, err);
    throw new UserFacingError("This clip's saved footage couldn't be found, so it can't be re-edited. Generate it again from the original video.");
  }
}

/**
 * Re-renders one already-generated short with its own overridden settings (caption
 * style/font/position/language/line-count/ratio, or a manual crop center) layered on top of its
 * parent project's current defaults — the same render as the first time (see render.ts), starting
 * from the short's saved footage instead of from the original video.
 *
 * On failure, the short reverts to status 'ready' (never 'failed') with its output_key
 * untouched — output_key is only ever written on a successful new render, so a failed edit
 * attempt can never destroy or hide the short's last good version.
 */
export async function regenerateShort(short: ShortRow): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), "cutforge-regen-"));
  try {
    const project = await getProject(short.project_id);
    if (!project) throw new Error(`No project ${short.project_id} for short ${short.id}`);

    const legacy = usesWholeTrimmedFile(project);
    const clipPath = join(tmpDir, "clip.mp4");
    if (legacy) {
      // Charged before any of the metered Whisper/render calls below run — same "charge before the
      // expensive work starts" ordering as the project-level charge_project_credits.
      await chargeShortRegenerateCredit(short.id);
      const trimmedPath = join(tmpDir, "trimmed.mp4");
      await downloadToFile(project.trimmed_key as string, trimmedPath);
      await extractClipRange(trimmedPath, short.source_start_seconds, short.source_end_seconds, clipPath);
    } else {
      // The footage is fetched first: a short whose footage is gone must not cost a credit.
      await downloadClipSource(project, short, clipPath);
      await chargeShortRegenerateCredit(short.id);
    }

    // The size the footage was made at, so removing its dead air can't quietly shrink it.
    const { width, height } = await getVideoDimensions(clipPath);
    const workingLongEdge = Math.max(width, height) > STANDARD_LONG_EDGE ? HD_LONG_EDGE : STANDARD_LONG_EDGE;

    const { outputKey, thumbnailKey } = await renderShort({
      sourcePath: clipPath,
      workDir: tmpDir,
      userId: project.user_id,
      settings: {
        ratio: resolve(short.ratio, project.ratio),
        captionStyle: resolve(short.caption_style, project.caption_style),
        captionFont: resolve(short.caption_font, project.caption_font),
        captionPosition: resolve(short.caption_position, project.caption_position),
        captionLanguage: resolve(short.caption_language, project.caption_language),
        captionLineCount: resolve(short.caption_line_count, project.caption_line_count),
        watermark: project.watermark,
      },
      // A manual crop center (set via the Reframe tool) always wins over face-detection — same
      // "this one thing always overrides" pattern as a caption preset's fontOverride.
      cropCenter: short.crop_x != null && short.crop_y != null ? { x: short.crop_x, y: short.crop_y } : null,
      removeDeadAir: !legacy,
      workingLongEdge,
    });

    // A failed thumbnail deliberately doesn't touch thumbnail_key at all (rather than nulling it
    // out) — a short that already had a good thumbnail from an earlier render keeps it rather than
    // losing it to an unrelated hiccup in this one extraction.
    const patch: Parameters<typeof updateShort>[1] = { status: "ready", output_key: outputKey, error_message: null };
    if (thumbnailKey) patch.thumbnail_key = thumbnailKey;
    await updateShort(short.id, patch);
  } catch (err) {
    console.error(`Regenerate failed for short ${short.id}:`, err);
    await updateShort(short.id, { status: "ready", error_message: toUserMessage(err) }).catch((updateErr) =>
      console.error("Also failed to record the short's regenerate failure:", updateErr)
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Extracts one representative, UNCROPPED frame (the midpoint of the short's own moment) from its
 * saved footage, for the Reframe tool's crop-tool background — the short's own already-rendered
 * output can't be reused for this, since it's already cropped to whatever ratio it was last rendered
 * at and can't show content outside that frame.
 */
export async function extractPreviewFrame(short: ShortRow): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), "cutforge-preview-"));
  try {
    const project = await getProject(short.project_id);
    if (!project) throw new Error(`No project ${short.project_id} for short ${short.id}`);

    const footagePath = join(tmpDir, "footage.mp4");
    let midpoint: number;
    if (usesWholeTrimmedFile(project)) {
      await downloadToFile(project.trimmed_key as string, footagePath);
      midpoint = (short.source_start_seconds + short.source_end_seconds) / 2;
    } else {
      await downloadClipSource(project, short, footagePath);
      midpoint = (await getDuration(footagePath)) / 2;
    }

    const framePath = join(tmpDir, "preview.jpg");
    await extractFrame(footagePath, midpoint, framePath);

    const previewKey = `${project.user_id}/preview/${randomUUID()}.jpg`;
    await uploadFromFile(framePath, previewKey, "image/jpeg");
    await updateShort(short.id, { preview_frame_key: previewKey });
  } catch (err) {
    console.error(`Preview frame extraction failed for short ${short.id}:`, err);
    // Reset to null rather than leaving it stuck on the pending sentinel forever — the frontend's
    // poll loop then sees a real, distinguishable "not pending, still no key" state and can let
    // the user retry, instead of polling forever for something that already failed.
    await updateShort(short.id, { preview_frame_key: null }).catch((updateErr) =>
      console.error("Also failed to reset the short's preview_frame_key:", updateErr)
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
