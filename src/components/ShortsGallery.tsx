"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { deleteShort, type Short } from "@/lib/projects";

function editHref(projectId: string, shortId: string, section: "settings" | "crop"): string {
  return `/shorts/edit?projectId=${projectId}&shortId=${shortId}&section=${section}`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Zero-padded minutes, matching the "[03:04 - 04:40]" bracket style — these are positions in the
// *source* video (sourceStartSeconds/sourceEndSeconds), not the short's own (much shorter) length.
function formatClockTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const STATUS_META: Record<Short["status"], { text: string; dot: string }> = {
  pending: { text: "Queued", dot: "bg-[#B0A996]" },
  processing: { text: "Rendering…", dot: "bg-[#F59E0B]" },
  ready: { text: "Ready", dot: "bg-[#10B981]" },
  failed: { text: "Failed", dot: "bg-[#EF4444]" },
  regenerating: { text: "Queued to regenerate…", dot: "bg-[#B0A996]" },
};

/** Lazily fetches the real rendered short's playable URL — same presigned-URL pattern used
 *  everywhere else in the app. Shared by both the grid thumbnail and the detail modal so neither
 *  duplicates the fetch. */
function useShortVideoUrl(projectId: string, short: Short): string | null {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (short.status !== "ready") return;
    fetch(`/api/download-url?projectId=${projectId}&shortId=${short.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { downloadUrl: string } | null) => {
        if (!cancelledRef.current && body?.downloadUrl) setVideoSrc(body.downloadUrl);
      })
      .catch(() => {});
    return () => {
      cancelledRef.current = true;
    };
  }, [projectId, short.id, short.status]);

  return videoSrc;
}

/** Same lazy presigned-URL pattern as useShortVideoUrl, for the short's real thumbnail_key
 *  instead — used as a <video poster> so a frame actually shows up immediately on every
 *  platform, rather than depending on mobile Safari/WebKit to self-render one from
 *  preload="metadata" alone (confirmed it doesn't: real thumbnails showed on desktop, stayed
 *  blank on phone, for the exact same ready shorts). Returns null (no poster) for a short that
 *  has no thumbnail yet — e.g. one rendered before this feature shipped, or a rare failed
 *  extraction — the <video> element just falls back to its own default behavior in that case. */
function useShortThumbnailUrl(projectId: string, short: Short): string | null {
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (short.status !== "ready" || !short.thumbnailKey) return;
    fetch(`/api/download-url?projectId=${projectId}&shortId=${short.id}&kind=thumbnail`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { downloadUrl: string } | null) => {
        if (!cancelledRef.current && body?.downloadUrl) setThumbSrc(body.downloadUrl);
      })
      .catch(() => {});
    return () => {
      cancelledRef.current = true;
    };
  }, [projectId, short.id, short.status, short.thumbnailKey]);

  return thumbSrc;
}

async function downloadShort(projectId: string, shortId: string): Promise<void> {
  // Opened synchronously so Safari still treats the later redirect as user-initiated — same
  // technique WorkspaceView's own download button uses.
  const downloadWindow = window.open("", "_blank");
  try {
    const res = await fetch(`/api/download-url?projectId=${projectId}&shortId=${shortId}`);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? "Could not prepare download");
    }
    const { downloadUrl } = (await res.json()) as { downloadUrl: string };
    if (downloadWindow) downloadWindow.location.href = downloadUrl;
    else window.location.href = downloadUrl;
  } catch (err) {
    downloadWindow?.close();
    throw err;
  }
}

function ShortCard({
  projectId,
  short,
  onOpen,
  onDeleted,
}: {
  projectId: string;
  short: Short;
  onOpen: () => void;
  onDeleted: (id: string) => void;
}) {
  const isReady = short.status === "ready";
  const videoSrc = useShortVideoUrl(projectId, short);
  const thumbSrc = useShortThumbnailUrl(projectId, short);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const meta = STATUS_META[short.status];
  const clipSeconds = short.sourceEndSeconds - short.sourceStartSeconds;
  const router = useRouter();

  function handleEdit(e: React.MouseEvent, section: "settings" | "crop") {
    e.stopPropagation();
    router.push(editHref(projectId, short.id, section));
  }

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (downloading || !isReady) return;
    setDownloading(true);
    try {
      await downloadShort(projectId, short.id);
    } catch {
      // Surfaced in the detail modal if they open it; the grid card stays compact.
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (deleting) return;
    if (!window.confirm("Delete this short? This can't be undone.")) return;
    setDeleting(true);
    try {
      await deleteShort(short.id);
      onDeleted(short.id);
    } catch {
      setDeleting(false);
    }
  }

  return (
    <article
      onClick={onOpen}
      className={`bg-white border border-[#ECE5E6] rounded-2xl overflow-hidden shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] cursor-pointer transition-shadow hover:shadow-[0_12px_32px_-6px_rgba(42,39,42,0.08)] ${
        deleting ? "opacity-40 pointer-events-none" : ""
      }`}
    >
      <div className="relative w-full aspect-[9/16] bg-[#FAF8F7] overflow-hidden">
        {/* The video element starts loading as soon as videoSrc is known (so it's ready sooner),
            but stays hidden behind the placeholder until it actually has a real frame to show —
            a <video> with no poster renders a solid black frame while it's still buffering, which
            otherwise flashes on top of this same light placeholder we just fixed the color of.
            `poster` is what actually fixes this reliably on mobile: a <video> with no poster
            depends on the browser self-rendering a first frame from preload="metadata" alone,
            which desktop browsers do but mobile Safari/WebKit (confirmed by the user: real
            thumbnails on desktop, blank/spinner-forever on phone for the same ready shorts) does
            not. */}
        {videoSrc && (
          <video
            src={videoSrc}
            poster={thumbSrc ?? undefined}
            muted
            playsInline
            preload="metadata"
            onLoadedData={() => setVideoLoaded(true)}
            className="w-full h-full object-cover"
          />
        )}
        {!videoLoaded && !thumbSrc && (
          <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-[#FAF8F7]">
            {short.status === "failed" ? (
              <span className="material-symbols-outlined text-[#D8D0CE] text-2xl">error_outline</span>
            ) : (
              <div className="w-5 h-5 rounded-full border-2 border-[#ECE5E6] border-t-[#ed8395] animate-spin" />
            )}
          </div>
        )}
        <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md text-white px-2 py-0.5 rounded-full text-[10px] font-semibold">
          {formatDuration(clipSeconds)}
        </div>
      </div>

      <div className="p-3 flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold text-[#1d1b1e] leading-snug line-clamp-2">{short.hook}</h3>

        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            disabled
            title="Direct publishing is coming soon"
            className="w-full flex items-center justify-center gap-1.5 bg-[#fdd5e1]/60 text-[#9a4153]/50 py-2 rounded-full text-xs font-semibold cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[14px]">send</span>
            Post
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!isReady || downloading}
            className="w-full flex items-center justify-center gap-1.5 bg-[#1d1b1e] hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white py-2 rounded-full text-xs font-semibold transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[14px]">download</span>
            {downloading ? "…" : "Download HD"}
          </button>
        </div>

        <div className="flex items-center justify-between pt-1.5 border-t border-[#ECE5E6]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => handleEdit(e, "settings")}
              title="Edit caption style, font, position, language, and line count"
              className="w-7 h-7 rounded-lg bg-[#fdd5e1]/60 hover:bg-[#fdd5e1] text-[#9a4153] flex items-center justify-center transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">edit_note</span>
            </button>
            <button
              type="button"
              onClick={(e) => handleEdit(e, "crop")}
              title="Reframe or change the aspect ratio"
              className="w-7 h-7 rounded-lg bg-[#fdd5e1]/60 hover:bg-[#fdd5e1] text-[#9a4153] flex items-center justify-center transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">crop</span>
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              title="Delete short"
              className="w-7 h-7 rounded-lg bg-[#fdd5e1]/60 hover:bg-[#fdd5e1] text-[#9a4153] flex items-center justify-center transition-colors disabled:opacity-50 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">{deleting ? "hourglass_empty" : "delete_outline"}</span>
            </button>
          </div>
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} title={meta.text} />
        </div>
      </div>
    </article>
  );
}

/** The modal view a clicked short opens into — mirrors the real product's pattern of a detail
 *  overlay rather than a separate page, with a "Scene analysis" section built from data the
 *  clip planner already produced (the real source timestamp range + its real reasoning, stored
 *  as `caption`) instead of inventing a new field for it. */
function ShortDetailModal({
  projectId,
  short,
  onClose,
  onDeleted,
}: {
  projectId: string;
  short: Short;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const isReady = short.status === "ready";
  const videoSrc = useShortVideoUrl(projectId, short);
  const thumbSrc = useShortThumbnailUrl(projectId, short);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  function handleEdit(section: "settings" | "crop") {
    router.push(editHref(projectId, short.id, section));
  }

  async function handleDownload() {
    if (downloading || !isReady) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadShort(projectId, short.id);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    if (!window.confirm("Delete this short? This can't be undone.")) return;
    setDeleting(true);
    try {
      await deleteShort(short.id);
      onDeleted(short.id);
      onClose();
    } catch {
      setDeleting(false);
    }
  }

  // Locks the background page while the modal is open — without this, a touch-scroll gesture
  // that starts over the backdrop can chain to the page behind it instead of the modal's own
  // scroll area, which is disorienting on mobile since the backdrop visually looks like part of
  // the same surface. `overflow: hidden` on body alone doesn't actually stop background
  // touch-scrolling on iOS Safari — a well-documented gap, not covered by testing this in a
  // Chromium-based emulator — so this pins the body in place at its current scroll offset
  // instead, which is the technique that actually holds on iOS too, then restores the exact
  // scroll position on close.
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = { position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Rendered into a portal on document.body rather than in place: WorkspaceShell's <main> has
  // `relative z-10`, which — since any positioned element with a non-auto z-index creates its
  // own stacking context — traps every descendant's z-index (including this modal's z-50)
  // inside that context. The page's sticky header sits *outside* main with z-50 of its own, so
  // it was compositing on top of the entire main box regardless of what z-index anything inside
  // it used, covering exactly the modal's title/close row with no way to scroll past it — not a
  // scroll bug at all, confirmed by inspecting the real deployed bundle after the previous
  // (scroll-focused) fix didn't help. A portal escapes main's stacking context entirely instead
  // of relying on ever-higher z-index numbers to outrun ancestors that might change later.
  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        // max-h uses dvh (dynamic viewport height), not vh: on mobile, percentage/vh-based
        // heights are computed against the browser's *large* viewport (address bar hidden), so
        // when the address bar is actually showing, a vh-sized panel can extend past the real
        // visible area with no way to scroll the clipped part back into view — confirmed as the
        // cause of "can't scroll up" reports on the previous top/bottom-percentage layout. dvh
        // tracks the actual visible viewport instead.
        className="w-full sm:w-[420px] max-h-[92dvh] bg-white rounded-3xl overflow-y-auto overscroll-contain shadow-[0_24px_64px_-12px_rgba(42,39,42,0.3)]"
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <h2 className="text-base font-semibold text-[#1d1b1e] leading-snug">{short.hook}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#7B7579] hover:bg-[#FAF8F7] transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          <div className="relative w-full aspect-[9/16] max-h-[50vh] rounded-2xl overflow-hidden bg-black mb-4">
            {videoSrc ? (
              <video src={videoSrc} poster={thumbSrc ?? undefined} controls playsInline className="w-full h-full object-contain bg-black" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                {short.status === "failed" ? (
                  <span className="material-symbols-outlined text-white/30 text-3xl">error_outline</span>
                ) : (
                  <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-[#ed8395] animate-spin" />
                )}
              </div>
            )}
          </div>

          {short.status === "failed" && short.errorMessage && <p className="text-xs text-[#B0503E] mb-3">{short.errorMessage}</p>}
          {downloadError && <p className="text-xs text-[#B0503E] mb-3">{downloadError}</p>}

          <div className="flex items-center gap-2 mb-5">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-full border border-[#ECE5E6] text-sm font-medium text-[#1d1b1e] hover:bg-[#FAF8F7] transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={() => handleEdit("settings")}
              title="Edit caption style, font, position, language, and line count"
              className="w-9 h-9 rounded-full bg-[#fdd5e1]/60 hover:bg-[#fdd5e1] text-[#9a4153] flex items-center justify-center transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">edit_note</span>
            </button>
            <button
              onClick={() => handleEdit("crop")}
              title="Reframe or change the aspect ratio"
              className="w-9 h-9 rounded-full bg-[#fdd5e1]/60 hover:bg-[#fdd5e1] text-[#9a4153] flex items-center justify-center transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">crop</span>
            </button>
            <button
              onClick={handleDownload}
              disabled={!isReady || downloading}
              title="Download HD"
              className="w-9 h-9 rounded-full bg-[#1d1b1e] hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
            </button>
          </div>

          <h3 className="text-sm font-semibold text-[#1d1b1e] mb-2">Scene analysis</h3>
          <span className="inline-block bg-[#FAF8F7] border border-[#ECE5E6] rounded-md px-2 py-0.5 text-xs font-mono text-[#544244] mb-2">
            [{formatClockTime(short.sourceStartSeconds)} - {formatClockTime(short.sourceEndSeconds)}]
          </span>
          <p className="text-sm text-[#544244] leading-relaxed mb-4">{short.caption}</p>

          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs text-[#7B7579] hover:text-[#EF4444] underline underline-offset-2 cursor-pointer disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete this short"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function ShortsGallery({
  projectId,
  shorts,
  onShortsChange,
}: {
  projectId: string;
  shorts: Short[];
  onShortsChange: (shorts: Short[]) => void;
}) {
  const [openShortId, setOpenShortId] = useState<string | null>(null);
  const readyCount = shorts.filter((s) => s.status === "ready").length;
  const openShort = shorts.find((s) => s.id === openShortId) ?? null;

  function handleDeleted(id: string) {
    onShortsChange(shorts.filter((s) => s.id !== id));
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="bg-white rounded-2xl p-4 border border-[#ECE5E6] shadow-sm">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#fdd5e1] text-[#795a64] text-[11px] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-[#9a4153]" />
          {shorts.length} clip{shorts.length === 1 ? "" : "s"} · {readyCount} ready
        </span>
      </section>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {shorts.map((short) => (
          <ShortCard
            key={short.id}
            projectId={projectId}
            short={short}
            onOpen={() => setOpenShortId(short.id)}
            onDeleted={handleDeleted}
          />
        ))}
      </div>

      {openShort && (
        <ShortDetailModal projectId={projectId} short={openShort} onClose={() => setOpenShortId(null)} onDeleted={handleDeleted} />
      )}
    </div>
  );
}
