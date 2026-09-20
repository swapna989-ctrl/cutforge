// How much picture to keep while a video is being worked on.
//
// A wide (landscape) video turned into a vertical short keeps only its middle third: the frame is
// scaled to cover 720x1280 and the overflow is cropped away. At the standard 720p working size that
// is about 405 real pixels across, stretched to 720 (a 1.78x enlargement), which is what makes vertical
// clips look soft. Keeping a 1080p working copy leaves 608 real pixels across (1.18x), visibly sharper.
// Only that case gains anything: a landscape output (1280x720) or a video that is already vertical
// gets no more detail from a bigger working copy, so those keep the cheaper standard size.
//
// The HD copy costs about three times the processing time and roughly twice the storage, so it is
// limited to videos up to HD_MAX_SECONDS. Beyond that the cost outweighs the gain.

/** Longer videos keep the standard working size. */
export const HD_MAX_SECONDS = 30 * 60;

/** The most a link is asked to download at when it will get an HD working copy. */
export const HD_DOWNLOAD_HEIGHT = 1080;
export const STANDARD_DOWNLOAD_HEIGHT = 720;

/**
 * Whether this video should be worked on at HD size. `dimensions` is omitted for a link that hasn't
 * been downloaded yet, which is treated as landscape (nearly every YouTube/Twitch video is). An unknown
 * length counts as not qualifying, so a file whose duration can't be read never silently gets the
 * expensive path.
 */
export function wantsHdWorkingCopy(
  ratio: string,
  durationSeconds: number | null,
  dimensions?: { width: number; height: number }
): boolean {
  if (ratio !== "9:16") return false;
  if (durationSeconds == null || !(durationSeconds > 0) || durationSeconds > HD_MAX_SECONDS) return false;
  if (dimensions && dimensions.width <= dimensions.height) return false;
  return true;
}

/** The tallest picture worth downloading for a linked video. */
export function linkedDownloadMaxHeight(ratio: string, durationSeconds: number | null): number {
  return wantsHdWorkingCopy(ratio, durationSeconds) ? HD_DOWNLOAD_HEIGHT : STANDARD_DOWNLOAD_HEIGHT;
}
