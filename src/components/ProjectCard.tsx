"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/projects";
import { deleteProject } from "@/lib/projects";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function ProjectCard({ project, onDeleted }: { project: Project; onDeleted: (id: string) => void }) {
  const router = useRouter();
  const isReady = project.status === "ready";
  const isFailed = project.pipelineStatus === "failed";

  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cancelledRef = useRef(false);

  // The thumbnail is the real rendered master, not a placeholder graphic — fetched lazily via
  // the same presigned-URL endpoint the workspace's download button already uses. Duration is
  // read straight off that same video element once its metadata loads, exactly like the
  // workspace preview does; nothing here is invented or stored anywhere new.
  useEffect(() => {
    cancelledRef.current = false;
    if (!isReady) return;
    fetch(`/api/download-url?projectId=${project.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { downloadUrl: string } | null) => {
        if (!cancelledRef.current && body?.downloadUrl) setThumbSrc(body.downloadUrl);
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
      : { text: "Processing…", cls: "bg-[#F59E0B]/15 text-[#F59E0B]" };

  return (
    <div
      className={`relative bg-white rounded-2xl p-3.5 border border-[#ECE5E6] shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] hover:shadow-[0_12px_32px_-6px_rgba(42,39,42,0.08),0_4px_12px_-2px_rgba(42,39,42,0.03)] transition-shadow ${
        deleting ? "opacity-40 pointer-events-none" : ""
      }`}
    >
      <Link href={`/workspace?load=${project.id}`} className="flex gap-3.5">
        <div
          className={`relative w-20 shrink-0 rounded-xl overflow-hidden bg-[#FAF8F7] border border-[#ECE5E6] ${
            project.ratio === "9:16" ? "aspect-[9/16]" : "aspect-video"
          }`}
        >
          {thumbSrc ? (
            <video
              src={thumbSrc}
              muted
              playsInline
              preload="metadata"
              className="w-full h-full object-cover"
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {!isReady && !isFailed && (
                <div className="w-6 h-6 rounded-full border-2 border-[#ECE5E6] border-t-[#ed8395] animate-spin" />
              )}
              {isFailed && <span className="material-symbols-outlined text-[#D8D0CE] text-xl">error_outline</span>}
            </div>
          )}
          {duration !== null && (
            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-medium">
              {formatDuration(duration)}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${statusPill.cls}`}>
                {statusPill.text}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-[#1d1b1e] truncate leading-snug">{project.name}</h3>
            <p className="text-xs text-[#7B7579] mt-0.5">
              {project.ratio} · {project.createdAt}
            </p>
          </div>

          {!isReady && !isFailed && (
            <div className="pt-2">
              <div className="w-full bg-[#ECE5E6] rounded-full h-1 overflow-hidden">
                <div className="bg-[#F59E0B] h-full rounded-full transition-all duration-500" style={{ width: `${project.progress}%` }} />
              </div>
            </div>
          )}
        </div>
      </Link>

      <div className="absolute top-3.5 right-3.5">
        <button
          onClick={(e) => {
            e.preventDefault();
            setMenuOpen((o) => !o);
          }}
          className="w-7 h-7 rounded-full hover:bg-[#FAF8F7] flex items-center justify-center text-[#7B7579] transition-colors cursor-pointer"
          aria-label="Project menu"
        >
          <span className="material-symbols-outlined text-[18px]">more_vert</span>
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-9 z-20 w-36 rounded-xl border border-[#ECE5E6] bg-white shadow-[0_12px_32px_-6px_rgba(42,39,42,0.12)] py-1.5">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  router.push(`/workspace?load=${project.id}`);
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-[#544244] hover:bg-[#FAF8F7] transition-colors cursor-pointer"
              >
                Open
              </button>
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
