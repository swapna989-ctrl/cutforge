import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { uploadFromFile } from "./r2.js";
import {
  cutSilences,
  detectSilences,
  extractAudio,
  extractFrame,
  finalizeVideo,
  getDuration,
  getVideoDimensions,
  multiClipTargetDimensions,
  normalizeToTargetResolution,
  type CaptionFont,
  type CaptionPosition,
  type CaptionStyle,
} from "./ffmpeg.js";
import { transcribeCaptions, type CaptionChunk, type CaptionLanguage, type CaptionLineCount } from "./transcribe.js";
import { detectFaceCenterFraction, type FaceCenterFraction } from "./faceCrop.js";

export type RenderSettings = {
  ratio: "9:16" | "16:9" | "1:1";
  captionStyle: CaptionStyle;
  captionFont: CaptionFont;
  captionPosition: CaptionPosition;
  captionLanguage: CaptionLanguage;
  captionLineCount: CaptionLineCount;
  watermark: boolean;
};

/** Where a short's own footage is kept so it can be re-edited later without going back to the
 *  original video (which for a linked video is not stored at all). One small file per short. */
export function clipSourceKey(userId: string, shortId: string): string {
  return `${userId}/clipsrc/${shortId}.mp4`;
}

/**
 * Turns one short's footage into its finished, uploaded video: dead-air removal, crop to the chosen
 * ratio (face-aware), burned-in captions, watermark, upload, thumbnail. Shared by the first render
 * (pipeline.ts) and a later re-render with new settings (regenerate.ts), so the two can't drift apart.
 *
 * `sourcePath` is exactly this short's moment, uncropped, at working-copy size. `workDir` must be
 * this render's own directory: several shorts are rendered at once and share nothing on disk.
 */
export async function renderShort(opts: {
  sourcePath: string;
  workDir: string;
  userId: string;
  settings: RenderSettings;
  /** A crop centre picked by hand. Omit to find the face automatically (the normal case). */
  cropCenter?: FaceCenterFraction | null;
  /** True for footage cut straight from the original video, which still has its pauses in. False for
   *  footage that had them taken out already (a project made before clips were cut per moment). */
  removeDeadAir: boolean;
  /** The working-copy size cap the footage was made at, so removing dead air can't quietly shrink it. */
  workingLongEdge: number;
}): Promise<{ outputKey: string; thumbnailKey: string | null }> {
  const { sourcePath, workDir, userId, settings } = opts;

  let clipPath = sourcePath;
  if (opts.removeDeadAir) {
    const rawDuration = await getDuration(sourcePath);
    const silences = await detectSilences(sourcePath);
    // Nothing to cut means nothing to re-encode: skipping saves a full extra pass per clip.
    if (silences.length > 0) {
      const trimmedPath = join(workDir, "deadair-removed.mp4");
      await cutSilences(sourcePath, silences, rawDuration, trimmedPath, workDir, opts.workingLongEdge);
      clipPath = trimmedPath;
    }
  }

  // Forces the user's actual chosen ratio here, regardless of how the footage arrived. Face-aware
  // when a face is actually found (see faceCrop.ts); falls back to plain center-crop otherwise.
  const target = multiClipTargetDimensions(settings.ratio);
  const clipDuration = await getDuration(clipPath);
  const faceCenter = opts.cropCenter ?? (await detectFaceCenterFraction(clipPath, clipDuration));
  const croppedPath = join(workDir, "cropped.mp4");
  await normalizeToTargetResolution(clipPath, croppedPath, target.width, target.height, faceCenter);

  // Skips the real Whisper call entirely for "none" — nothing will be burned in, so paying for a
  // transcription no render step will ever read would be pure waste.
  let captionChunks: CaptionChunk[] = [];
  if (settings.captionStyle !== "none") {
    const audioPath = join(workDir, "audio.mp3");
    await extractAudio(croppedPath, audioPath);
    captionChunks = await transcribeCaptions(audioPath, settings.captionLanguage, settings.captionLineCount);
  }

  const dimensions = await getVideoDimensions(croppedPath);
  const finalPath = join(workDir, "final.mp4");
  await finalizeVideo(
    croppedPath,
    captionChunks,
    settings.captionStyle,
    settings.captionFont,
    settings.captionPosition,
    settings.watermark,
    dimensions.width,
    dimensions.height,
    finalPath,
    join(workDir, "captions.ass")
  );

  const outputKey = `${userId}/shorts/${randomUUID()}.mp4`;
  await uploadFromFile(finalPath, outputKey, "video/mp4");

  // From the FINAL rendered output (captions/crop/watermark already applied), so it shows exactly
  // what the user will get. Mobile Safari doesn't reliably draw a <video>'s first frame from
  // preload="metadata" alone, so the frontend uses this as a real poster. Non-fatal: a failed
  // extraction just means no thumbnail yet, not a failed short.
  let thumbnailKey: string | null = null;
  try {
    const thumbPath = join(workDir, "thumbnail.jpg");
    await extractFrame(finalPath, 1, thumbPath);
    thumbnailKey = `${userId}/thumbnails/${randomUUID()}.jpg`;
    await uploadFromFile(thumbPath, thumbnailKey, "image/jpeg");
  } catch (err) {
    console.error("Thumbnail extraction failed (non-fatal):", err);
    thumbnailKey = null;
  }

  return { outputKey, thumbnailKey };
}
