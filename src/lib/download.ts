function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS masquerades as desktop Safari in its own UA string (no "iPad" substring) unless the
  // site opts into a "request desktop site"-style UA override — maxTouchPoints on a "MacIntel"
  // platform is the standard way to still catch it.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * Delivers an already-resolved presigned R2 URL to the user. Every platform except iOS just
 * navigates `downloadWindow` (or the current tab, if the popup was blocked) to `downloadUrl`
 * exactly as before — that already works well (Content-Disposition: attachment triggers a normal
 * save-to-Downloads there).
 *
 * iOS Safari has no web API that saves straight to Photos/Camera Roll — navigating to an
 * attachment-disposition URL instead opens "Save to Files" (iCloud Drive/On My iPhone), which is
 * a real, confirmed complaint (works fine on desktop, wrong destination on iPhone). The best
 * available route is the native share sheet's "Save Video" option via the Web Share API, tried
 * first here — but confirmed, via a real user testing in Chrome for iOS, that Web Share file
 * support is inconsistent across which iOS *browser* you're in (every third-party iOS browser is
 * a WKWebView wrapper that doesn't get full parity with Safari's own capabilities, the same
 * pattern as WebRTC, Service Workers, and Safari Extensions all being Safari-only on iOS too) —
 * canShare/share can legitimately be present but non-functional.
 *
 * So the fallback when Web Share isn't available *or fails for any reason* isn't the attachment
 * URL — it's `inlineUrl` (no attachment disposition), which opens the browser's own native
 * full-page video player. Long-press-to-save on that player's "Save Video" option is a system
 * media-viewer feature, not a per-browser JS capability, so it works the same across Safari,
 * Chrome, and any other WKWebView-based iOS browser. `inlineUrl` is optional only because the
 * legacy master-download flow predates it being wired through everywhere; without it, iOS falls
 * back to the same attachment URl every other platform uses.
 */
export async function deliverDownload(downloadUrl: string, downloadWindow: Window | null, inlineUrl?: string): Promise<void> {
  const iosFallbackUrl = inlineUrl ?? downloadUrl;

  if (isIOS() && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
    try {
      const fileRes = await fetch(downloadUrl);
      if (!fileRes.ok) throw new Error("Could not fetch video");
      const filename = fileRes.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "flovura-clip.mp4";
      const blob = await fileRes.blob();
      const file = new File([blob], filename, { type: "video/mp4" });

      if (navigator.canShare({ files: [file] })) {
        // Closed only once share() has actually resolved — closing it beforehand and then having
        // share() fail (e.g. iOS treating the user-activation as expired after a slow multi-MB
        // blob fetch, which throws something other than AbortError) left the fallback below
        // trying to navigate an already-closed window, which throws, silently, with no visible
        // outcome at all: confirmed as the real cause of a reported "glitches back to the same
        // page, no share sheet" regression.
        await navigator.share({ files: [file] });
        downloadWindow?.close();
        return;
      }
    } catch (err) {
      // The user dismissing the share sheet without picking anything throws AbortError — not a
      // real failure, so it's treated as a completed (if unsaved) download, not an error state.
      if (err instanceof Error && err.name === "AbortError") {
        downloadWindow?.close();
        return;
      }
      // Any other failure (blob fetch failed, canShare said no, share() itself rejected — e.g.
      // expired user-activation, or this browser just doesn't really implement it) falls through
      // to the native-player fallback below, on the same still-open popup.
    }

    try {
      if (downloadWindow && !downloadWindow.closed) {
        downloadWindow.location.href = iosFallbackUrl;
        return;
      }
    } catch {
      // Falls through to the current-tab navigation at the bottom.
    }
    window.location.href = iosFallbackUrl;
    return;
  }

  // Guarded rather than a plain `downloadWindow.location.href = ...`: the popup can be dead by
  // now for reasons outside this function's control too (the user closed it while a slow blob
  // fetch above was still running), and navigating a dead window throws — this always ends in a
  // real navigation somewhere rather than a silent no-op.
  try {
    if (downloadWindow && !downloadWindow.closed) {
      downloadWindow.location.href = downloadUrl;
      return;
    }
  } catch {
    // Falls through to the current-tab navigation below.
  }
  window.location.href = downloadUrl;
}
