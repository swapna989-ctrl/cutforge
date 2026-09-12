"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import IngestCard from "@/components/IngestCard";
import SynthesisCard from "@/components/SynthesisCard";
import ExportCard, { type ExportSnapshot } from "@/components/ExportCard";
import type { PipelineStatus, Ratio } from "@/lib/pipeline";
import { createProject, updateProject, deleteProject, getProject, type Project } from "@/lib/projects";
import { usePrefs } from "@/lib/prefs";
import { useBilling } from "@/lib/billing";

export default function WorkspaceView({ initialProject }: { initialProject?: Project }) {
  const { prefs, ready: prefsReady } = usePrefs();
  const billing = useBilling();
  // The real Supabase row id backing this session, once ingest has created one.
  const projectIdRef = useRef<string | null>(initialProject?.id ?? null);
  const lastStatusMessageRef = useRef<string | null>(initialProject?.statusMessage ?? null);

  const [ratio, setRatio] = useState<Ratio>(initialProject?.ratio ?? "9:16");

  const [status, setStatus] = useState<PipelineStatus>(initialProject?.pipelineStatus ?? "idle");
  const [fileName, setFileName] = useState<string | null>(initialProject?.name ?? null);
  const [progress, setProgress] = useState(initialProject?.progress ?? 0);
  const [log, setLog] = useState<string[]>(initialProject?.statusMessage ? [initialProject.statusMessage] : []);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialProject?.errorMessage ?? null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [downloadState, setDownloadState] = useState<"idle" | "preparing" | "done">("idle");
  const [exportSnapshot, setExportSnapshot] = useState<ExportSnapshot | null>(null);
  const downloadInFlightRef = useRef(false);

  // Pick up the user's saved default ratio for brand-new (non-resumed) projects, once prefs load.
  useEffect(() => {
    if (!initialProject && prefsReady) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRatio(prefs.defaultRatio);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to prefs becoming ready, not every prefs change
  }, [prefsReady]);

  // Poll the real project row while a worker could plausibly be acting on it. The worker
  // processes jobs in the background regardless of whether anyone's watching, so this is
  // genuinely "what's the current state", not a client-driven simulation.
  useEffect(() => {
    if (status !== "queued" && status !== "synthesizing") return;
    const id = projectIdRef.current;
    if (!id) return;

    const interval = setInterval(async () => {
      try {
        const project = await getProject(id);
        if (!project) return;

        setProgress(project.progress);
        if (project.statusMessage && project.statusMessage !== lastStatusMessageRef.current) {
          lastStatusMessageRef.current = project.statusMessage;
          setLog((l) => [...l, project.statusMessage as string]);
        }

        if (project.pipelineStatus === "failed") {
          setErrorMessage(project.errorMessage);
          setStatus("failed");
        } else if (project.pipelineStatus === "ready") {
          setStatus("ready");
        } else if (project.pipelineStatus !== status) {
          setStatus(project.pipelineStatus);
        }
      } catch (err) {
        console.error("Poll failed:", err);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [status]);

  async function handleFile(file: File) {
    setFileName(file.name);
    setStatus("ingesting");
    setUploadError(null);
    setErrorMessage(null);

    try {
      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type || "video/mp4" }),
      });
      if (!urlRes.ok) {
        const body = await urlRes.json().catch(() => null);
        throw new Error(body?.error ?? "Could not prepare upload");
      }
      const { uploadUrl, key } = (await urlRes.json()) as { uploadUrl: string; key: string };

      const putRes = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "video/mp4" } });
      if (!putRes.ok) throw new Error("Upload to storage failed");

      const created = await createProject({
        name: file.name,
        ratio,
        pipelineStatus: "queued",
        progress: 0,
        sourceKey: key,
        watermark: !billing.isWatermarkFree,
      });
      projectIdRef.current = created.id;
      lastStatusMessageRef.current = null;
      setLog([]);
      setStatus("queued");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      setStatus("idle");
      setFileName(null);
    }
  }

  function handleReset() {
    // "Replace clip" (and "Try again" after a failure) abandons whatever was ingested — delete
    // its row rather than leaving an orphaned draft behind.
    if (projectIdRef.current) {
      deleteProject(projectIdRef.current).catch(() => {});
      projectIdRef.current = null;
    }
    setStatus("idle");
    setFileName(null);
    setProgress(0);
    setLog([]);
    setErrorMessage(null);
    setUploadError(null);
    lastStatusMessageRef.current = null;
    setDownloadState("idle");
    setExportSnapshot(null);
    downloadInFlightRef.current = false;
    setPlaying(false);
  }

  function handleDownload() {
    // Guards against double-spending a credit on a double-click. A ref (not the downloadState
    // *value*) is what actually blocks re-entrancy, since React state updates aren't visible
    // synchronously — several clicks fired in the same tick would all still see the old
    // "idle" state and all pass a check against downloadState alone.
    const id = projectIdRef.current;
    if (!billing.ready || !billing.canExport || downloadInFlightRef.current || !id) return;
    downloadInFlightRef.current = true;

    // Snapshot what this export will look like *before* consumeExportCredit mutates billing
    // state, so the delivered master's watermark/credit display can't retroactively change.
    // Note this is just the preview label — the file itself was already rendered watermarked
    // or not, decided once at upload time (see projects.watermark).
    const watermarkFree = billing.isWatermarkFree;
    const label = watermarkFree
      ? billing.hasActivePlan
        ? "No watermark · unlimited exports on your plan"
        : `No watermark · ${billing.paidCredits - 1} paid credit${billing.paidCredits - 1 === 1 ? "" : "s"} left`
      : `Includes CutForge watermark (${billing.freeCredits - 1} free export${billing.freeCredits - 1 === 1 ? "" : "s"} left)`;

    setDownloadState("preparing");
    (async () => {
      try {
        const res = await fetch(`/api/download-url?projectId=${id}`);
        if (!res.ok) throw new Error("Could not prepare download");
        const { downloadUrl } = (await res.json()) as { downloadUrl: string };

        // Server-enforced — this can genuinely fail (e.g. another tab spent the last credit in
        // the gap between the canExport check above and now), not just a local state update.
        const { error } = await billing.consumeExportCredit();
        if (error) {
          setDownloadState("idle");
          downloadInFlightRef.current = false;
          return;
        }

        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = fileName ?? "cutforge-master.mp4";
        document.body.appendChild(a);
        a.click();
        a.remove();

        setExportSnapshot({ watermarkFree, label });
        setDownloadState("done");
        window.setTimeout(() => {
          setDownloadState("idle");
          downloadInFlightRef.current = false;
        }, 1700);
      } catch (err) {
        console.error(err);
        setDownloadState("idle");
        downloadInFlightRef.current = false;
      }
    })();
  }

  function handlePlay() {
    setPlaying((p) => !p);
  }

  function handleSetRatio(next: Ratio) {
    setRatio(next);
    if (projectIdRef.current) {
      updateProject(projectIdRef.current, { ratio: next }).catch(() => {});
    }
  }

  const formatReadout = ratio === "9:16" ? "9:16 TIKTOK / REELS" : "16:9 CINEMATIC MASTER";

  return (
    <>
      <Link
        href="/dashboard"
        className="inline-flex items-center space-x-1.5 text-xs font-mono text-zinc-500 hover:text-amber-200 transition-colors mb-8"
      >
        <span className="material-symbols-outlined text-[15px]">arrow_back</span>
        <span>Back to dashboard</span>
      </Link>

      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <h1 className="font-display text-4xl sm:text-6xl md:text-7xl font-semibold tracking-tight text-white cf-text-glow leading-[1.08]">
          Video made for you.
        </h1>
        <p className="font-body text-base sm:text-lg text-zinc-400 font-light max-w-xl mx-auto leading-relaxed">
          From raw clips to a finished cut — CutForge ingests, edits, and masters your footage across one autonomous pipeline.
        </p>

        <div className="pt-6 flex flex-col items-center">
          <div className="inline-flex items-center p-1 rounded-full bg-[#141418] border border-white/10 shadow-inner">
            <button
              onClick={() => handleSetRatio("9:16")}
              className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-300 select-none flex items-center space-x-1.5 cursor-pointer ${
                ratio === "9:16" ? "bg-[#fbf6ee] text-[#08080a] shadow-[0_0_16px_rgba(244,213,141,0.35)] font-semibold" : "text-zinc-400 hover:text-white"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">stay_current_portrait</span>
              <span>9:16 Vertical</span>
            </button>
            <button
              onClick={() => handleSetRatio("16:9")}
              className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-300 select-none flex items-center space-x-1.5 cursor-pointer ${
                ratio === "16:9" ? "bg-[#fbf6ee] text-[#08080a] shadow-[0_0_16px_rgba(244,213,141,0.35)] font-semibold" : "text-zinc-400 hover:text-white"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">crop_16_9</span>
              <span>16:9 Cinema</span>
            </button>
          </div>
          <p className="text-xs font-mono text-zinc-500 mt-2.5 tracking-wider uppercase">
            OUTPUT CANVAS: <span className="text-amber-200/90 font-medium">{formatReadout}</span>
          </p>
        </div>
      </div>

      <section className="mt-16 sm:mt-20">
        <div className="flex items-center justify-between pb-6 border-b border-white/[0.06] mb-8">
          <div className="flex items-center space-x-3">
            <span className="text-xs font-mono tracking-widest text-amber-300/80 uppercase">WORKFLOW PIPELINE</span>
            <span className="text-zinc-600">•</span>
            <span className="text-xs text-zinc-400 tracking-wide font-body">Step 01 Ingest ➔ Step 02 Synthesize ➔ Step 03 Export</span>
          </div>
          <div className="hidden sm:flex items-center space-x-2 text-xs font-mono text-zinc-500">
            <span className="w-2 h-2 rounded-full bg-amber-400/80" />
            <span>AUTONOMOUS ENGINE ACTIVE</span>
          </div>
        </div>

        {uploadError && (
          <p className="text-center text-xs text-red-400 mb-6 font-mono">{uploadError}</p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          <IngestCard ratio={ratio} status={status} fileName={fileName} onFile={handleFile} onReset={handleReset} />
          <SynthesisCard ratio={ratio} status={status} progress={progress} log={log} />
          <ExportCard
            ratio={ratio}
            status={status}
            playing={playing}
            downloadState={downloadState}
            exportSnapshot={exportSnapshot}
            errorMessage={errorMessage}
            onPlay={handlePlay}
            onReEdit={handleReset}
            onDownload={handleDownload}
          />
        </div>
      </section>

      <footer className="mt-20 pt-8 border-t border-white/[0.06] flex flex-col sm:flex-row justify-between items-center text-xs text-zinc-400 font-body space-y-4 sm:space-y-0">
        <div className="flex items-center space-x-3">
          <span className="font-display font-bold tracking-[0.2em] text-white">CUTFORGE</span>
          <span className="text-zinc-600">/</span>
          <span className="text-zinc-500">Autonomous Editorial Video Intelligence</span>
        </div>
        <div className="flex items-center space-x-6 font-mono text-[11px] text-zinc-500">
          <span className="flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>SYSTEM NOMINAL</span>
          </span>
          <span>LATENCY: 12MS</span>
          <span className="text-zinc-400">v4.8 SPEC</span>
        </div>
      </footer>
    </>
  );
}
