/**
 * Navigates to a presigned R2 URL that already carries a Content-Disposition: attachment header
 * (see getDownloadUrl) — the browser intercepts that as a download rather than actually leaving
 * the current page, exactly like clicking any plain download link. `popup` is optional: pass it
 * when the caller had to open one ahead of an unavoidable async gap (e.g. charging a credit)
 * to keep the navigation "user-initiated" in Safari's eyes; omit it when the URL was already
 * known synchronously at click time, since there's nothing to work around in that case.
 *
 * Deliberately simple. An earlier version of this tried the Web Share API first for a one-tap
 * "Save Video" on iOS, with a fallback native-video-player page for when that failed — confirmed,
 * via real user testing, that Web Share's file-sharing support is inconsistent across which iOS
 * *browser* you're in (Chrome for iOS has canShare/share present but non-functional), and even
 * the fallback path added a confusing extra page in between. A real competitor's app (shown by
 * the user) downloads in place and lands on the OS's own Files/Save prompt — this matches that
 * directly instead of trying to be cleverer than the platform.
 */
export function navigateToDownload(url: string, popup: Window | null = null): void {
  try {
    if (popup && !popup.closed) {
      popup.location.href = url;
      return;
    }
  } catch {
    // Falls through to the current-tab navigation below.
  }
  window.location.href = url;
}
