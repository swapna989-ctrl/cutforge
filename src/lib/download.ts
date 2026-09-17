function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS masquerades as desktop Safari in its own UA string (no "iPad" substring) unless the
  // site opts into a "request desktop site"-style UA override — maxTouchPoints on a "MacIntel"
  // platform is the standard way to still catch it.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * Delivers an already-resolved presigned R2 URL to the user. Every platform except iOS just
 * navigates `downloadWindow` (or the current tab, if the popup was blocked) to it exactly as
 * before — that already works well (Content-Disposition: attachment triggers a normal
 * save-to-Downloads there).
 *
 * iOS Safari has no web API that saves straight to Photos/Camera Roll — navigating to an
 * attachment-disposition URL instead opens "Save to Files" (iCloud Drive/On My iPhone), which is
 * a real, confirmed user complaint (works fine on desktop, wrong destination on iPhone). The only
 * route to a "Save Video" (Camera Roll) option at all is the native share sheet via the Web Share
 * API, so iOS gets a real fetch-as-blob + navigator.share attempt first, falling back to the
 * plain-navigation path if sharing isn't available or fails for any other reason.
 */
export async function deliverDownload(downloadUrl: string, downloadWindow: Window | null): Promise<void> {
  if (isIOS() && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
    try {
      const fileRes = await fetch(downloadUrl);
      if (!fileRes.ok) throw new Error("Could not fetch video");
      const filename = fileRes.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "flovura-clip.mp4";
      const blob = await fileRes.blob();
      const file = new File([blob], filename, { type: "video/mp4" });

      if (navigator.canShare({ files: [file] })) {
        downloadWindow?.close();
        await navigator.share({ files: [file] });
        return;
      }
    } catch (err) {
      // The user dismissing the share sheet without picking anything throws AbortError — not a
      // real failure, so it's treated as a completed (if unsaved) download, not an error state.
      if (err instanceof Error && err.name === "AbortError") {
        downloadWindow?.close();
        return;
      }
      // Any other failure (blob fetch failed, canShare said no, share() itself rejected) falls
      // through to the plain-navigation path below instead of leaving the user stuck.
    }
  }

  if (downloadWindow) downloadWindow.location.href = downloadUrl;
  else window.location.href = downloadUrl;
}
