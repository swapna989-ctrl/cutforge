"use client";

import { useRef, useState } from "react";
import type { PipelineStatus, Ratio } from "@/lib/pipeline";

export default function IngestCard({
  ratio,
  status,
  fileName,
  onFile,
  onReset,
}: {
  ratio: Ratio;
  status: PipelineStatus;
  fileName: string | null;
  onFile: (file: File) => void;
  onReset: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const isIdle = status === "idle";
  const isIngesting = status === "ingesting";
  const isHandedOff = status === "queued" || status === "synthesizing" || status === "ready" || status === "failed";

  const badge = isIdle
    ? { text: "Ready", cls: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" }
    : isIngesting
      ? { text: "Uploading", cls: "bg-amber-400/10 border-amber-400/30 text-amber-300" }
      : { text: "Complete", cls: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" };

  return (
    <article className="bg-[#121216]/90 border border-white/[0.08] hover:border-white/[0.15] rounded-[32px] p-7 sm:p-8 flex flex-col justify-between shadow-cf-card relative overflow-hidden backdrop-blur-md group transition-all duration-300">
      <div className="absolute top-0 left-12 right-12 h-[1px] bg-gradient-to-r from-transparent via-amber-200/25 to-transparent" />

      <div className="flex justify-between items-center pb-5 border-b border-white/[0.06]">
        <div className="flex items-center space-x-2.5">
          <span className="w-6 h-6 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center font-mono text-[11px] text-amber-200/90 font-medium">
            01
          </span>
          <span className="text-xs font-medium tracking-wide uppercase text-zinc-400 font-mono">Ingestion</span>
        </div>
        <span className={`px-2.5 py-1 rounded-full border font-mono text-[10px] tracking-widest font-semibold uppercase ${badge.cls}`}>
          {badge.text}
        </span>
      </div>

      <div className="my-6 flex flex-col items-center text-center">
        <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white">Drop raw footage.</h2>
        <p className="font-body text-xs sm:text-sm text-zinc-400 mt-2 max-w-xs font-light leading-relaxed">
          Drag in your raw clips and CutForge handles the rest — auto-syncing footage, checking color space, and prepping every frame for the cut.
        </p>

        <div className="mt-7 flex items-center justify-center w-full">
          <div
            className={`${ratio === "9:16" ? "ratio-frame-9-16" : "ratio-frame-16-9"} rounded-2xl bg-[#0b0b0e] border p-5 flex flex-col justify-between items-center transition-all duration-500 ease-out relative shadow-inner ${
              isIdle
                ? `border-dashed cursor-pointer ${dragOver ? "border-amber-300/60" : "border-white/15 hover:border-amber-300/40"}`
                : "border-white/10"
            }`}
            onClick={() => isIdle && inputRef.current?.click()}
            onDragOver={(e) => {
              if (!isIdle) return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              if (!isIdle) return;
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) onFile(file);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
                e.target.value = "";
              }}
            />

            <div className="w-full flex justify-between items-center font-mono text-[10px] text-zinc-500">
              <span className="flex items-center space-x-1.5 text-zinc-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80" />
                <span>VAULT // A1</span>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-300">{ratio}</span>
            </div>

            {isIdle && (
              <>
                <div className="flex flex-col items-center space-y-3 my-auto">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-b from-white/10 to-white/[0.02] border border-white/15 flex items-center justify-center group-hover:scale-105 group-hover:border-amber-300/50 group-hover:shadow-[0_0_20px_rgba(244,213,141,0.2)] transition-all">
                    <span className="material-symbols-outlined text-amber-200 text-2xl">cloud_upload</span>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-white block">Drop Master Clips</span>
                    <span className="text-[11px] text-zinc-500 font-mono">or tap to browse files</span>
                  </div>
                </div>
                <div className="w-full bg-[#131317] rounded-xl p-2.5 border border-white/[0.06] text-left font-mono text-[10px] text-zinc-400">
                  <div className="text-amber-200/80 flex items-center space-x-1">
                    <span>$</span>
                    <span className="text-zinc-300">cutforge ingest --auto-sync</span>
                  </div>
                  <div className="text-zinc-500 text-[9px] mt-0.5">wiring 10-bit color pipeline... ok</div>
                </div>
              </>
            )}

            {isIngesting && (
              <div className="flex flex-col items-center space-y-3 my-auto">
                <div className="w-14 h-14 rounded-full border border-amber-300/40 flex items-center justify-center animate-spin [animation-duration:1.4s] border-t-transparent" />
                <div className="max-w-[150px]">
                  <span className="text-xs font-medium text-white block truncate">{fileName}</span>
                  <span className="text-[11px] text-zinc-500 font-mono">reading clip…</span>
                </div>
              </div>
            )}

            {isHandedOff && (
              <>
                <div className="flex flex-col items-center space-y-3 my-auto">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-b from-emerald-400/20 to-white/[0.02] border border-emerald-400/30 flex items-center justify-center">
                    <span className="material-symbols-outlined text-emerald-300 text-2xl">check_circle</span>
                  </div>
                  <div className="max-w-[150px]">
                    <span className="text-xs font-medium text-white block truncate">{fileName}</span>
                    <span className="text-[11px] text-zinc-500 font-mono">ingested • {ratio}</span>
                  </div>
                </div>
                <button
                  onClick={onReset}
                  className="w-full text-[10px] font-mono text-zinc-400 hover:text-amber-200 border border-white/[0.06] hover:border-amber-300/30 rounded-xl py-2 transition-all cursor-pointer"
                >
                  Replace clip
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-white/[0.06] flex justify-between items-center text-xs font-mono text-zinc-500">
        <span className="flex items-center space-x-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
          <span>10-BIT LOG DCI-P3</span>
        </span>
        <span className="text-amber-200/80">AIR-GAPPED SECURE</span>
      </div>
    </article>
  );
}
