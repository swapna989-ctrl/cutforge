"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import IngestCard from "@/components/IngestCard";
import SynthesisCard from "@/components/SynthesisCard";
import ExportCard, { type ExportSnapshot } from "@/components/ExportCard";
import { SYNTH_STEPS, stepsCompletedAt, type PipelineStatus, type Ratio } from "@/lib/pipeline";
import type { Project } from "@/lib/projects";
import { usePrefs } from "@/lib/prefs";
import { useBilling } from "@/lib/billing";

export default function WorkspaceView({ initialProject }: { initialProject?: Project }) {
  const { prefs, ready: prefsReady } = usePrefs();
  const billing = useBilling();

  const [ratio, setRatio] = useState<Ratio>(initialProject?.ratio ?? "9:16");

  const [status, setStatus] = useState<PipelineStatus>(initialProject?.pipelineStatus ?? "idle");
  const [fileName, setFileName] = useState<string | null>(initialProject?.name ?? null);
  const [progress, setProgress] = useState(initialProject?.progress ?? 0);
  const initialDoneCount = initialProject ? stepsCompletedAt(initialProject.progress) : 0;
  const [log, setLog] = useState<string[]>(SYNTH_STEPS.slice(0, initialDoneCount).map((s) => s.msg));
  const loggedCountRef = useRef(initialDoneCount);

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

  // Drive the synthesis progress simulation.
  useEffect(() => {
    if (status !== "synthesizing") return;
    const id = setInterval(() => {
      setProgress((p) => Math.min(100, p + 1 + Math.floor(Math.random() * 2)));
    }, 160);
    return () => clearInterval(id);
  }, [status]);

  // Append activity log lines as progress crosses each step's threshold, and finish when done.
  useEffect(() => {
    if (status !== "synthesizing") return;
    while (loggedCountRef.current < SYNTH_STEPS.length && SYNTH_STEPS[loggedCountRef.current].at <= progress) {
      const step = SYNTH_STEPS[loggedCountRef.current];
      setLog((l) => [...l, step.msg]);
      loggedCountRef.current += 1;
    }
    if (progress >= 100) setStatus("ready");
  }, [progress, status]);

  function handleFile(file: File) {
    setFileName(file.name);
    setStatus("ingesting");
    window.setTimeout(() => {
      loggedCountRef.current = 0;
      setLog([]);
      setProgress(0);
      setStatus("synthesizing");
    }, 700);
  }

  function handleReset() {
    setStatus("idle");
    setFileName(null);
    setProgress(0);
    setLog([]);
    loggedCountRef.current = 0;
    setDownloadState("idle");
    setExportSnapshot(null);
    downloadInFlightRef.current = false;
    setPlaying(false);
  }

  function handleReEdit() {
    const doneCount = stepsCompletedAt(55);
    loggedCountRef.current = doneCount;
    setLog([...SYNTH_STEPS.slice(0, doneCount).map((s) => s.msg), "Restoring timeline for another pass — reapplying beat sync…"]);
    setProgress(55);
    setStatus("synthesizing");
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
    if (!billing.ready || !billing.canExport || downloadInFlightRef.current) return;
    downloadInFlightRef.current = true;

    // Snapshot what this export will look like *before* consumeExportCredit mutates billing
    // state, so the delivered master's watermark/credit display can't retroactively change.
    const watermarkFree = billing.isWatermarkFree;
    const label = watermarkFree
      ? billing.hasActivePlan
        ? "No watermark · unlimited exports on your plan"
        : `No watermark · ${billing.paidCredits - 1} paid credit${billing.paidCredits - 1 === 1 ? "" : "s"} left`
      : `Includes CutForge watermark (${billing.freeCredits - 1} free export${billing.freeCredits - 1 === 1 ? "" : "s"} left)`;

    setDownloadState("preparing");
    window.setTimeout(() => {
      billing.consumeExportCredit();
      setExportSnapshot({ watermarkFree, label });
      setDownloadState("done");
    }, 900);
    window.setTimeout(() => {
      setDownloadState("idle");
      downloadInFlightRef.current = false;
    }, 2600);
  }

  function handlePlay() {
    setPlaying((p) => !p);
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
              onClick={() => setRatio("9:16")}
              className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-300 select-none flex items-center space-x-1.5 cursor-pointer ${
                ratio === "9:16" ? "bg-[#fbf6ee] text-[#08080a] shadow-[0_0_16px_rgba(244,213,141,0.35)] font-semibold" : "text-zinc-400 hover:text-white"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">stay_current_portrait</span>
              <span>9:16 Vertical</span>
            </button>
            <button
              onClick={() => setRatio("16:9")}
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          <IngestCard ratio={ratio} status={status} fileName={fileName} onFile={handleFile} onReset={handleReset} />
          <SynthesisCard ratio={ratio} status={status} progress={progress} log={log} />
          <ExportCard
            ratio={ratio}
            status={status}
            playing={playing}
            downloadState={downloadState}
            exportSnapshot={exportSnapshot}
            onPlay={handlePlay}
            onReEdit={handleReEdit}
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
