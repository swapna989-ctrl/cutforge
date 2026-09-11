"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { useRequireAuth } from "@/lib/auth";
import { listProjects, type Project } from "@/lib/projects";

export default function DashboardPage() {
  const { ready, user } = useRequireAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    listProjects()
      .then((data) => {
        if (cancelled) return;
        setProjects(data);
        setLoadState("loaded");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load projects.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  if (!ready || !user) return null;

  return (
    <AppShell>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10">
        <div>
          <p className="text-xs font-mono tracking-widest text-amber-300/80 uppercase mb-2">Welcome back, {user.name}</p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-white">Your projects</h1>
          <p className="text-sm text-zinc-400 font-body mt-1">Pick up a master or start forging a new cut.</p>
        </div>
        <Link
          href="/workspace"
          className="inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-full text-xs font-bold bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 hover:shadow-cf-pill-lg transition-all duration-300 whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          <span>New Project</span>
        </Link>
      </div>

      {loadState === "loading" && <p className="text-sm text-zinc-500 font-mono">Loading your projects…</p>}

      {loadState === "error" && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-5 text-sm text-red-300 font-body">
          <p className="font-medium mb-1">Couldn&apos;t load your projects.</p>
          <p className="text-red-400/80 text-xs font-mono">{loadError}</p>
          <p className="text-zinc-400 text-xs mt-2">
            If this is a fresh Supabase project, make sure the <code className="text-zinc-300">projects</code> table migration has been run
            (<code className="text-zinc-300">supabase/migrations/0001_projects.sql</code>).
          </p>
        </div>
      )}

      {loadState === "loaded" && projects.length === 0 && (
        <div className="rounded-2xl border border-white/[0.08] bg-[#121216]/90 p-10 text-center">
          <span className="material-symbols-outlined text-zinc-600 text-4xl mb-3 inline-block">movie</span>
          <p className="text-white font-display text-lg font-semibold mb-1">No projects yet</p>
          <p className="text-sm text-zinc-400 font-body mb-5">Drop your first clip in the workspace to start forging a cut.</p>
          <Link
            href="/workspace"
            className="inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-full text-xs font-bold bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 hover:shadow-cf-pill-lg transition-all duration-300"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            <span>New Project</span>
          </Link>
        </div>
      )}

      {loadState === "loaded" && projects.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => {
            const isReady = project.status === "ready";
            return (
              <Link
                key={project.id}
                href={`/workspace?load=${project.id}`}
                className="bg-[#121216]/90 border border-white/[0.08] hover:border-amber-300/30 rounded-2xl p-5 flex flex-col transition-all duration-300 group"
              >
                <div
                  className={`w-full rounded-xl bg-[#0b0b0e] border border-white/10 flex flex-col items-center justify-center mb-4 relative overflow-hidden ${
                    project.ratio === "9:16" ? "aspect-[9/16] max-h-40 mx-auto w-auto" : "aspect-video"
                  }`}
                >
                  <span className="material-symbols-outlined text-zinc-700 text-3xl group-hover:text-amber-300/60 transition-colors">
                    {isReady ? "play_circle" : "edit_note"}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-600 group-hover:text-amber-200/70 transition-colors mt-1">
                    {isReady ? "Open" : "Resume editing"}
                  </span>
                  <span className="absolute top-2 left-2 text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/60 border border-white/10 text-zinc-300">
                    {project.ratio}
                  </span>
                  {!isReady && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60">
                      <div className="h-full bg-gradient-to-r from-amber-300 to-amber-500" style={{ width: `${project.progress}%` }} />
                    </div>
                  )}
                </div>

                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-sm font-medium text-white truncate">{project.name}</span>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-full border font-mono text-[9px] tracking-widest font-semibold uppercase ${
                      isReady ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-amber-400/10 border-amber-400/30 text-amber-300"
                    }`}
                  >
                    {isReady ? "Ready" : `Draft • ${project.progress}%`}
                  </span>
                </div>
                <div className="flex items-center space-x-2 text-[11px] font-mono text-zinc-500">
                  <span>{project.createdAt}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
