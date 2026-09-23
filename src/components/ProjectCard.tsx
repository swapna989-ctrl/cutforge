"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/projects";
import { deleteProject, listShorts } from "@/lib/projects";
import CircularProgress from "@/components/CircularProgress";

export default function ProjectCard({ project, onDeleted }: { project: Project; onDeleted: (id: string) => void }) {
  const router = useRouter();
  const isReady = project.status === "ready";
  const isFailed = project.pipelineStatus === "failed";
  // "ingesting" is the upload-then-configure step (see clipping/page.tsx's configure panel) —
  // the worker only ever claims "queued" jobs (see worker/src/supabase.ts's claimNextJob), so
  // nothing is actually being processed yet here, no matter how long this step takes. Showing it
  // as "Processing… 0%" the same as real worker states was genuinely misleading: it read as the
  // video already being worked on before the user had even picked their options and hit Generate.
  const isIngesting = project.pipelineStatus === "ingesting";

  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [posterSrc, setPosterSrc] = useState<string | null>(null);
  const [shortsCount, setShortsCount] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cancelledRef = useRef(false);

  // Real shorts for this project drive both the real clip count and the real thumbnail — a
  // project from the AI Clip Planner never gets a project-level output_key (see
  // worker/src/pipeline.ts), so its first ready short's own render is the only real footage to
  // show. A project from before the planner existed still has output_key set, and falls back to
  // that exactly as this card always has.
  useEffect(() => {
    cancelledRef.current = false;
    if (!isReady) return;

    listShorts(project.id)
      .then(async (shorts) => {
        if (cancelledRef.current) return;
        setShortsCount(shorts.length);

        const firstReady = shorts.find((s) => s.status === "ready" && s.outputKey);
        const url = firstReady
          ? `/api/download-url?projectId=${project.id}&shortId=${firstReady.id}`
          : `/api/download-url?projectId=${project.id}`;

        const res = await fetch(url);
        if (res.ok) {
          const body = (await res.json()) as { downloadUrl?: string };
          if (!cancelledRef.current && body.downloadUrl) setVideoSrc(body.downloadUrl);
        }

        // A real image frame from the short's own final render, used as this <video>'s poster —
        // mobile Safari/WebKit doesn't reliably self-render a first frame from preload="metadata"
        // alone (confirmed: real thumbnails on desktop, blank on phone, for the same ready
        // projects), so this is what actually fixes that rather than depending on it.
        if (firstReady?.thumbnailKey) {
          const posterRes = await fetch(`/api/download-url?projectId=${project.id}&shortId=${firstReady.id}&kind=thumbnail`);
          if (posterRes.ok) {
            const posterBody = (await posterRes.json()) as { downloadUrl?: string };
            if (!cancelledRef.current && posterBody.downloadUrl) setPosterSrc(posterBody.downloadUrl);
          }
        }
      })
      .catch(() => {});

    return () => {
      cancelledRef.current = true;
    };
  }, [project.id, isReady]);

  async function handleDelete() {
    setMenuOpen(false);
    if (!window.confirm(`Delete "${project.name}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await deleteProject(project.id);
      onDeleted(project.id);
    } catch {
      setDeleting(false);
    }
  }

  const statusPill = isFailed
    ? { text: "Failed", cls: "bg-[#EF4444]/10 text-[#EF4444]" }
    : isReady
      ? { text: "Ready", cls: "bg-[#10B981]/10 text-[#10B981]" }
      : isIngesting
        ? { text: "Draft", cls: "bg-[#B3ACA6]/15 text-[#7B7579]" }
        : { text: "Processing…", cls: "bg-[#F59E0B]/15 text-[#F59E0B]" }; // the ring below already shows the percent

  // Only a finished project (ready or failed) has anywhere real to go — a still-processing one
  // has no clips yet, so it stays put on this page and its progress bar below is the loading
  // experience, rather than linking out to a workspace screen with nothing to show.
  const isNavigable = isReady || isFailed;

  const cardBody = (
    <>
      <div className="relative w-full aspect-video bg-[#FAF8F7]">
        {videoSrc ? (
          <video src={videoSrc} poster={posterSrc ?? undefined} muted playsInline preload="metadata" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            {isIngesting && <span className="material-symbols-outlined text-[#D8D0CE] text-2xl">edit_note</span>}
            {!isReady && !isFailed && !isIngesting && <CircularProgress percent={project.progress} />}
            {isFailed && <span className="material-symbols-outlined text-[#D8D0CE] text-2xl">error_outline</span>}
            {isReady && !videoSrc && <span className="material-symbols-outlined text-[#D8D0CE] text-2xl">movie</span>}
          </div>
        )}
      </div>

      <div className="p-3.5">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${statusPill.cls}`}>
            {statusPill.text}
          </span>
          {isReady && shortsCount !== null && shortsCount > 0 && (
            <span className="text-[11px] font-medium text-[#9a4153]">{shortsCount} clips</span>
          )}
        </div>
        <h3 className="text-sm font-semibold text-[#1d1b1e] truncate leading-snug">{project.name}</h3>
        <p className="text-xs text-[#7B7579] mt-0.5">
          {project.ratio} · {project.createdAt}
        </p>

        {!isReady && !isFailed && !isIngesting && (
          <div className="pt-2">
            {project.statusMessage && (
              <span className="inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-full bg-[#FAF8F7] border border-[#ECE5E6]">
                <span className="w-3 h-3 rounded-full border-2 border-[#ECE5E6] border-t-[#ed8395] animate-spin shrink-0" />
                <span className="text-[11px] text-[#544244] truncate">{project.statusMessage}</span>
              </span>
            )}
            <p className="text-[11px] text-[#B3ACA6] mt-2 leading-snug">Long videos can take 20-30 minutes.</p>
          </div>
        )}

        {isIngesting && <p className="text-[11px] text-[#B3ACA6] mt-2">Pick your options above and hit Generate clips</p>}
        {isReady && (
          <p className="text-[11px] text-[#B3ACA6] mt-2">
            Click to view and download clips
            {project.creditsCharged > 0 && <> · Used {project.creditsCharged.toLocaleString("en-IN")} credits</>}
          </p>
        )}
        {isFailed && project.errorMessage && <p className="text-[11px] text-[#EF4444] mt-2 line-clamp-2">{project.errorMessage}</p>}
      </div>
    </>
  );

  return (
    <div
      className={`relative bg-white rounded-2xl border border-[#ECE5E6] shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] hover:shadow-[0_12px_32px_-6px_rgba(42,39,42,0.08),0_4px_12px_-2px_rgba(42,39,42,0.03)] transition-shadow overflow-hidden ${
        deleting ? "opacity-40 pointer-events-none" : ""
      }`}
    >
      {isNavigable ? <Link href={`/workspace?load=${project.id}`}>{cardBody}</Link> : cardBody}

      <div className="absolute top-3 right-3">
        <button
          onClick={(e) => {
            e.preventDefault();
            setMenuOpen((o) => !o);
          }}
          className="w-7 h-7 rounded-full bg-white/90 hover:bg-white flex items-center justify-center text-[#7B7579] shadow-sm transition-colors cursor-pointer"
          aria-label="Project menu"
        >
          <span className="material-symbols-outlined text-[18px]">more_vert</span>
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-9 z-20 w-36 rounded-xl border border-[#ECE5E6] bg-white shadow-[0_12px_32px_-6px_rgba(42,39,42,0.12)] py-1.5">
              {isNavigable && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    router.push(`/workspace?load=${project.id}`);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-[#544244] hover:bg-[#FAF8F7] transition-colors cursor-pointer"
                >
                  Open
                </button>
              )}
              <button
                onClick={handleDelete}
                className="w-full text-left px-3 py-1.5 text-xs text-[#7B7579] hover:bg-[#FAF8F7] hover:text-[#EF4444] transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
