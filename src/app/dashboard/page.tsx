"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import ProjectCard from "@/components/ProjectCard";
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

  function handleDeleted(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }

  if (!ready || !user) return null;

  return (
    <DashboardShell>
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold text-white">Your projects</h1>
        <Link
          href="/workspace"
          className="inline-flex items-center space-x-2 px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 transition-all whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          <span>New Project</span>
        </Link>
      </div>

      {loadState === "loading" && <p className="text-sm text-zinc-500">Loading your projects…</p>}

      {loadState === "error" && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-5 text-sm text-red-300">
          <p className="font-medium mb-1">Couldn&apos;t load your projects.</p>
          <p className="text-red-400/80 text-xs">{loadError}</p>
        </div>
      )}

      {loadState === "loaded" && projects.length === 0 && (
        <div className="rounded-2xl border border-white/[0.08] py-20 text-center">
          <p className="text-white font-display text-lg mb-1">No projects yet</p>
          <p className="text-sm text-zinc-500 mb-6">Drop your first clip to start a cut.</p>
          <Link
            href="/workspace"
            className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            <span>New Project</span>
          </Link>
        </div>
      )}

      {loadState === "loaded" && projects.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} onDeleted={handleDeleted} />
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
