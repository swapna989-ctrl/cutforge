"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/projects";
import { deleteProject, listShorts } from "@/lib/projects";

export default function ProjectCard({ project, onDeleted }: { project: Project; onDeleted: (id: string) => void }) {
  const router = useRouter();
  const isReady = project.status === "ready";
  const isFailed = project.pipelineStatus === "failed";

  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
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
        if (!res.ok) return;
        const body = (await res.json()) as { downloadUrl?: string };
        if (!cancelledRef.current && body.downloadUrl) setThumbSrc(body.downloadUrl);
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
      : { text: `Processing… ${project.progress}%`, cls: "bg-[#F59E0B]/15 text-[#F59E0B]" };

  // Only a finished project (ready or failed) has anywhere real to go — a still-processing one
  // has no clips yet, so it stays put on this page and its progress bar below is the loading
  // experience, rather than linking out to a workspace screen with nothing to show.
  const isNavigable = isReady || isFailed;

  const cardBody = (
    <>
      <div className="relative w-full aspect-video bg-[#FAF8F7]">
        {thumbSrc ? (
          <video src={thumbSrc} muted playsInline preload="metadata" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            {!isReady && !isFailed && (
              <>
                <div className="w-6 h-6 rounded-full border-2 border-[#ECE5E6] border-t-[#ed8395] animate-spin" />
                <span className="text-xs font-semibold text-[#B3ACA6]">{project.progress}%</span>
              </>
            )}
            {isFailed && <span className="material-symbols-outlined text-[#D8D0CE] text-2xl">error_outline</span>}
            {isReady && !thumbSrc && <span className="material-symbols-outlined text-[#D8D0CE] text-2xl">movie</span>}
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

        {!isReady && !isFailed && (
          <div className="pt-2">
            <div className="w-full bg-[#ECE5E6] rounded-full h-1 overflow-hidden">
              <div className="bg-[#F59E0B] h-full rounded-full transition-all duration-500" style={{ width: `${project.progress}%` }} />
            </div>
            {project.statusMessage && <p className="text-[11px] text-[#B3ACA6] mt-1.5">{project.statusMessage}</p>}
          </div>
        )}

        {isReady && <p className="text-[11px] text-[#B3ACA6] mt-2">Click to view and download clips</p>}
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
