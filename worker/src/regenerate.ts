import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { downloadToFile, uploadFromFile } from "./r2.js";
import {
  extractClipRange,
  extractAudio,
  extractFrame,
  finalizeVideo,
  normalizeToTargetResolution,
  multiClipTargetDimensions,
  getVideoDimensions,
} from "./ffmpeg.js";
import { transcribeCaptions, type CaptionChunk } from "./transcribe.js";
import { detectFaceCenterFraction } from "./faceCrop.js";
import { getProject, updateShort, chargeShortRegenerateCredit, type ShortRow } from "./supabase.js";

/** null on the short means "inherit the parent project's current default" — same nullable-override
 *  pattern as CaptionPresetSpec's fontOverride in ffmpeg.ts. */
function resolve<T>(shortValue: T | null, projectValue: T): T {
  return shortValue ?? projectValue;
}

/**
 * Re-renders one already-generated short with its own overridden settings (caption
 * style/font/position/language/line-count/ratio, or a manual crop center) layered on top of its
 * parent project's current defaults — mirrors worker/src/pipeline.ts's per-short render block
 * almost exactly, the two differences being: this downloads the project's persisted trimmed_key
 * instead of already having the trimmed file in hand from the same job, and it charges 1 flat
 * credit (see chargeShortRegenerateCredit) instead of the project-level duration-scaled charge.
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
    if (!project.trimmed_key) {
      throw new Error("This project was generated before editing was supported, so there's no saved source to re-cut this clip from.");
    }

    // Charged before any of the metered Whisper/render calls below run — same "charge before the
    // expensive work starts" ordering as the project-level charge_project_credits.
    await chargeShortRegenerateCredit(short.id);

    const trimmedPath = join(tmpDir, "trimmed.mp4");
    await downloadToFile(project.trimmed_key, trimmedPath);

    const ratio = resolve(short.ratio, project.ratio);
    const captionStyle = resolve(short.caption_style, project.caption_style);
    const captionFont = resolve(short.caption_font, project.caption_font);
    const captionPosition = resolve(short.caption_position, project.caption_position);
    const captionLanguage = resolve(short.caption_language, project.caption_language);
    const captionLineCount = resolve(short.caption_line_count, project.caption_line_count);

    const clipPath = join(tmpDir, "clip.mp4");
    const clipCroppedPath = join(tmpDir, "clip-cropped.mp4");
    const clipAudioPath = join(tmpDir, "clip-audio.mp3");
    const clipAssPath = join(tmpDir, "clip.ass");
    const clipFinalPath = join(tmpDir, "clip-final.mp4");

    await extractClipRange(trimmedPath, short.source_start_seconds, short.source_end_seconds, clipPath);

    const target = multiClipTargetDimensions(ratio);
    // A manual crop center (set via the Reframe tool) always wins over face-detection — same
    // "this one thing always overrides" pattern as a caption preset's fontOverride.
    const faceCenter =
      short.crop_x != null && short.crop_y != null
        ? { x: short.crop_x, y: short.crop_y }
        : await detectFaceCenterFraction(clipPath, short.source_end_seconds - short.source_start_seconds);
    await normalizeToTargetResolution(clipPath, clipCroppedPath, target.width, target.height, faceCenter);

    // Skips the real Whisper call entirely for "none" — same real-cost-avoidance reasoning as
    // pipeline.ts's own per-short loop.
    let captionChunks: CaptionChunk[] = [];
    if (captionStyle !== "none") {
      await extractAudio(clipCroppedPath, clipAudioPath);
      captionChunks = await transcribeCaptions(clipAudioPath, captionLanguage, captionLineCount);
    }
    const clipDimensions = await getVideoDimensions(clipCroppedPath);
    await finalizeVideo(
      clipCroppedPath,
      captionChunks,
      captionStyle,
      captionFont,
      captionPosition,
      project.watermark,
      clipDimensions.width,
      clipDimensions.height,
      clipFinalPath,
      clipAssPath
    );

    const shortOutputKey = `${project.user_id}/shorts/${randomUUID()}.mp4`;
    await uploadFromFile(clipFinalPath, shortOutputKey, "video/mp4");

    // From the FINAL rendered output (captions/crop/watermark already applied), not the source —
    // this should show exactly what the user will actually see, same reasoning as pipeline.ts's
    // own per-short thumbnail step. A failure here shouldn't fail the whole regenerate, and
    // deliberately doesn't touch thumbnail_key at all on failure (rather than nulling it out) —
    // a short that already had a good thumbnail from an earlier render keeps it rather than
    // losing it to an unrelated hiccup in this one extraction.
    const patch: Parameters<typeof updateShort>[1] = { status: "ready", output_key: shortOutputKey, error_message: null };
    try {
      const thumbPath = join(tmpDir, "thumbnail.jpg");
      await extractFrame(clipFinalPath, 1, thumbPath);
      const thumbnailKey = `${project.user_id}/thumbnails/${randomUUID()}.jpg`;
      await uploadFromFile(thumbPath, thumbnailKey, "image/jpeg");
      patch.thumbnail_key = thumbnailKey;
    } catch (err) {
      console.error(`Thumbnail extraction failed for short ${short.id} (non-fatal):`, err);
    }

    await updateShort(short.id, patch);
  } catch (err) {
    console.error(`Regenerate failed for short ${short.id}:`, err);
    const detail = err instanceof Error ? err.message : String(err);
    await updateShort(short.id, { status: "ready", error_message: detail }).catch((updateErr) =>
      console.error("Also failed to record the short's regenerate failure:", updateErr)
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Extracts one representative, UNCROPPED frame (the midpoint of the short's own time range) from
 * the project's persisted trimmed source, for the Reframe tool's crop-tool background — the
 * short's own already-rendered output can't be reused for this, since it's already cropped to
 * whatever ratio it was last rendered at and can't show content outside that frame.
 */
export async function extractPreviewFrame(short: ShortRow): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), "cutforge-preview-"));
  try {
    const project = await getProject(short.project_id);
    if (!project) throw new Error(`No project ${short.project_id} for short ${short.id}`);
    if (!project.trimmed_key) {
      throw new Error("This project was generated before editing was supported, so there's no saved source to preview a crop from.");
    }

    const trimmedPath = join(tmpDir, "trimmed.mp4");
    await downloadToFile(project.trimmed_key, trimmedPath);

    const midpoint = (short.source_start_seconds + short.source_end_seconds) / 2;
    const framePath = join(tmpDir, "preview.jpg");
    await extractFrame(trimmedPath, midpoint, framePath);

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
