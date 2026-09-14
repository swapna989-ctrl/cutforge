"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Playfair_Display } from "next/font/google";
import DashboardShell from "@/components/DashboardShell";
import ProjectCard from "@/components/ProjectCard";
import { useRequireAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { useBilling } from "@/lib/billing";
import { listProjects, createProject, type Project } from "@/lib/projects";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

export default function DashboardPage() {
  const router = useRouter();
  const { ready, user } = useRequireAuth();
  const { prefs, ready: prefsReady } = usePrefs();
  const billing = useBilling();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [submittingUrl, setSubmittingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

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

  // The combined bar's one action: a pasted link starts a real link-ingestion project (the
  // worker downloads it — see worker/src/ytdlp.ts); an empty field just opens the upload flow,
  // same destination the old plain "New Project" link always used.
  async function handleUrlSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) {
      router.push("/workspace");
      return;
    }
    setUrlError(null);
    setSubmittingUrl(true);
    try {
      const created = await createProject({
        name: trimmed,
        ratio: prefsReady ? prefs.defaultRatio : "9:16",
        pipelineStatus: "queued",
        progress: 0,
        sourceUrl: trimmed,
        watermark: !billing.isWatermarkFree,
      });
      router.push(`/workspace?load=${created.id}`);
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "Could not start this project");
      setSubmittingUrl(false);
    }
  }

  if (!ready || !user) return null;

  return (
    <DashboardShell>
      <section className="pt-2 space-y-2 mb-6">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#fdd5e1]/60 text-[#9a4153] text-[11px] font-semibold tracking-wide">
          <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
          <span>Your workspace</span>
        </div>
        <h1 className={`${playfair.className} text-3xl sm:text-4xl font-semibold text-[#1d1b1e] tracking-tight`}>
          The <span className="italic text-[#9a4153]">Clipping</span> Agent
        </h1>
        <p className="text-sm text-[#7B7579] leading-relaxed max-w-md">
          Upload your footage — CutForge removes dead air and adds captions automatically.
        </p>
      </section>

      {/* Combined entry card. The upload icon always opens the file-upload flow. The URL field
          is real now — the worker downloads whatever's pasted there (see worker/src/ytdlp.ts)
          and then treats it identically to an uploaded file. The primary button does whichever
          of the two makes sense: submits the link if one's been typed, otherwise opens upload. */}
      <section className="mb-8 space-y-3">
        <form onSubmit={handleUrlSubmit} className="space-y-3">
          <div className="bg-white rounded-2xl p-2 pl-2.5 pr-2.5 border border-[#ECE5E6] shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => router.push("/workspace")}
              aria-label="Upload footage"
              className="w-11 h-11 rounded-xl bg-[#FAF8F7] text-[#9a4153] flex items-center justify-center shrink-0 hover:bg-[#fdd5e1]/60 transition-colors active:scale-95 duration-150 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[22px]">cloud_upload</span>
            </button>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={submittingUrl}
              placeholder="Paste a YouTube or Twitch link…"
              className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm text-[#1d1b1e] placeholder:text-[#B3ACA6] focus:ring-0 focus:outline-none disabled:cursor-not-allowed"
            />
          </div>

          {urlError && <p className="text-xs text-[#B0503E] px-1">{urlError}</p>}

          <div className="flex items-start gap-2 px-1 text-[#7B7579]">
            <span className="material-symbols-outlined text-[15px] mt-0.5 text-[#B3ACA6] shrink-0">info</span>
            <p className="text-[11px] leading-normal">YouTube / Twitch links, or MP4 / MOV uploads · 9:16 or 16:9</p>
          </div>

          <button
            type="submit"
            disabled={submittingUrl}
            className="w-full py-3.5 px-6 rounded-full bg-[#ed8395] text-white font-semibold text-sm shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">content_cut</span>
            <span>{submittingUrl ? "Starting…" : urlInput.trim() ? "Get clips from link" : "Start a new cut"}</span>
          </button>
        </form>
      </section>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[#1d1b1e]">Your projects</h2>
      </div>

      {loadState === "loading" && <p className="text-sm text-[#7B7579]">Loading your projects…</p>}

      {loadState === "error" && (
        <div className="rounded-2xl border border-[#EF4444]/20 bg-[#EF4444]/[0.04] p-5 text-sm text-[#B0503E]">
          <p className="font-medium mb-1">Couldn&apos;t load your projects.</p>
          <p className="text-xs opacity-80">{loadError}</p>
        </div>
      )}

      {loadState === "loaded" && projects.length === 0 && (
        <div className="rounded-2xl border border-[#ECE5E6] bg-white py-16 text-center">
          <p className={`${playfair.className} text-lg text-[#1d1b1e] mb-1`}>No projects yet</p>
          <p className="text-sm text-[#7B7579] mb-6">Drop your first clip to start a cut.</p>
          <button
            onClick={() => router.push("/workspace")}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-[#ed8395] text-white shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            <span>New Project</span>
          </button>
        </div>
      )}

      {loadState === "loaded" && projects.length > 0 && (
        <div className="space-y-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} onDeleted={handleDeleted} />
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
