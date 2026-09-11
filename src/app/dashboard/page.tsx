"use client";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import { useRequireAuth } from "@/lib/auth";
import { MOCK_PROJECTS } from "@/lib/projects";

export default function DashboardPage() {
  const { ready, user } = useRequireAuth();

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
          className="cf-pill-main inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-full text-xs font-bold bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 hover:shadow-cf-pill-lg transition-all duration-300 whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          <span>New Project</span>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {MOCK_PROJECTS.map((project) => {
          const isReady = project.status === "ready";
          return (
            <Link
              key={project.id}
              href={isReady ? `/workspace?load=${project.id}` : "/workspace"}
              className="cf-card bg-[#121216]/90 border border-white/[0.08] hover:border-amber-300/30 rounded-2xl p-5 flex flex-col transition-all duration-300 group"
            >
              <div
                className={`w-full rounded-xl bg-[#0b0b0e] border border-white/10 flex items-center justify-center mb-4 relative overflow-hidden ${
                  project.ratio === "9:16" ? "aspect-[9/16] max-h-40 mx-auto w-auto" : "aspect-video"
                }`}
              >
                <span className="material-symbols-outlined text-zinc-700 text-3xl group-hover:text-amber-300/60 transition-colors">
                  {isReady ? "play_circle" : "hourglass_top"}
                </span>
                <span className="absolute top-2 left-2 text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/60 border border-white/10 text-zinc-300">
                  {project.ratio}
                </span>
              </div>

              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="text-sm font-medium text-white truncate">{project.name}</span>
                <span
                  className={`shrink-0 px-2 py-0.5 rounded-full border font-mono text-[9px] tracking-widest font-semibold uppercase ${
                    isReady ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-white/[0.06] border-white/10 text-zinc-400"
                  }`}
                >
                  {isReady ? "Ready" : "Draft"}
                </span>
              </div>
              <div className="flex items-center space-x-2 text-[11px] font-mono text-zinc-500">
                <span>{project.createdAt}</span>
                <span>•</span>
                <span>{project.duration}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
