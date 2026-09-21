// How much picture to keep while a clip is being worked on.
//
// A wide (landscape) video turned into a vertical short keeps only its middle third: the frame is
// scaled to cover 720x1280 and the overflow is cropped away. At the standard 720p working size that
// is about 405 real pixels across, stretched to 720 (a 1.78x enlargement), which is what makes vertical
// clips look soft. Keeping a 1080p working copy leaves 608 real pixels across (1.18x), visibly sharper.
// Only that case gains anything: a landscape output (1280x720) or a video that is already vertical
// gets no more detail from a bigger working copy, so those keep the cheaper standard size.
//
// Only the moments that become clips are ever fetched and re-encoded (see pipeline.ts), so the HD copy
// costs a fixed, small amount per clip however long the source is -- there is no length limit on it.

/** The most a link is asked to stream at when it will get an HD working copy. */
export const HD_DOWNLOAD_HEIGHT = 1080;
export const STANDARD_DOWNLOAD_HEIGHT = 720;

/**
 * Whether clips from this video should be worked on at HD size. `dimensions` is omitted for a link
 * that hasn't been resolved yet, which is treated as landscape (nearly every YouTube/Twitch video is).
 */
export function wantsHdWorkingCopy(ratio: string, dimensions?: { width: number; height: number }): boolean {
  if (ratio !== "9:16") return false;
  if (dimensions && dimensions.width <= dimensions.height) return false;
  return true;
}

/** The tallest picture worth streaming for a linked video. */
export function linkedDownloadMaxHeight(ratio: string): number {
  return wantsHdWorkingCopy(ratio) ? HD_DOWNLOAD_HEIGHT : STANDARD_DOWNLOAD_HEIGHT;
}
