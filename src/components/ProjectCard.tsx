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

  const statusLabel = isFailed
    ? { text: "Failed", cls: "text-red-400" }
    : isReady
      ? { text: "Ready", cls: "text-emerald-400" }
      : { text: "Processing…", cls: "text-amber-300" };

  return (
    <div className={`group relative rounded-2xl border border-white/[0.08] hover:border-white/20 bg-[#121216] transition-colors ${deleting ? "opacity-40 pointer-events-none" : ""}`}>
      <Link href={`/workspace?load=${project.id}`} className="block p-3">
        <div
          className={`w-full rounded-xl bg-black overflow-hidden relative ${
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
                <div className="w-8 h-8 rounded-full border-2 border-white/15 border-t-white/40 animate-spin" />
              )}
              {isFailed && <span className="material-symbols-outlined text-zinc-700 text-2xl">error_outline</span>}
            </div>
          )}

          {!isReady && !isFailed && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/5">
              <div className="h-full bg-amber-300/70" style={{ width: `${project.progress}%` }} />
            </div>
          )}
        </div>

        <div className="mt-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm text-white truncate">{project.name}</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {project.ratio}
              {duration !== null && <> · {formatDuration(duration)}</>} · {project.createdAt}
            </p>
          </div>
          <span className={`shrink-0 text-[11px] ${statusLabel.cls}`}>{statusLabel.text}</span>
        </div>
      </Link>

      <div className="absolute top-4 right-4">
        <button
          onClick={(e) => {
            e.preventDefault();
            setMenuOpen((o) => !o);
          }}
          className="w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-zinc-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
          aria-label="Project menu"
        >
          <span className="material-symbols-outlined text-[16px]">more_vert</span>
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-9 z-20 w-36 rounded-xl border border-white/[0.08] bg-[#1a1a1f] shadow-cf-card py-1.5">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  router.push(`/workspace?load=${project.id}`);
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer"
              >
                Open
              </button>
              <button
                onClick={handleDelete}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/[0.06] hover:text-red-400 transition-colors cursor-pointer"
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
