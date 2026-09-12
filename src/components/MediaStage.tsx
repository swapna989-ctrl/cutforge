"use client";

import { useRef, useState } from "react";
import type { PipelineStatus, Ratio } from "@/lib/pipeline";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function MediaStage({
  ratio,
  status,
  fileName,
  fileSizeBytes,
  duration,
  previewSrc,
  progress,
  statusMessage,
  errorMessage,
  onFile,
  onReset,
  onDurationLoaded,
}: {
  ratio: Ratio;
  status: PipelineStatus;
  fileName: string | null;
  fileSizeBytes: number | null;
  duration: number | null;
  previewSrc: string | null;
  progress: number;
  statusMessage: string | null;
  errorMessage: string | null;
  onFile: (file: File) => void;
  onReset: () => void;
  onDurationLoaded: (seconds: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const isIdle = status === "idle";
  const isProcessing = status === "ingesting" || status === "queued" || status === "synthesizing";
  const isReady = status === "ready";
  const isFailed = status === "failed";
  const hasClip = !isIdle;

  // Empty state: the dropzone IS the workspace — full-bleed, not a card competing for space.
  if (isIdle) {
    return (
      <div
        className={`rounded-[32px] border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center text-center px-6 py-24 sm:py-32 cursor-pointer ${
          dragOver ? "border-amber-300/50 bg-amber-400/[0.03]" : "border-white/10 hover:border-amber-300/30 bg-white/[0.015]"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
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
        <div className="w-16 h-16 rounded-full bg-gradient-to-b from-white/10 to-white/[0.02] border border-white/15 flex items-center justify-center mb-5">
          <span className="material-symbols-outlined text-amber-200 text-3xl">movie</span>
        </div>
        <h2 className="font-display text-xl sm:text-2xl font-semibold text-white mb-1.5">Drop your footage here</h2>
        <p className="text-sm text-zinc-500 font-body">or tap to browse — CutForge handles the rest</p>
      </div>
    );
  }

  const previewShapeClass =
    ratio === "9:16" ? "aspect-[9/16] max-h-[62vh] sm:max-h-[68vh] mx-auto" : "aspect-video w-full max-w-3xl mx-auto";

  return (
    <div className="space-y-4">
      {/* Media strip: real facts about the actual file, a Replace action, nothing invented. */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#121216]/90 px-4 py-3">
        <div className="flex items-center space-x-3 min-w-0">
          <span className="material-symbols-outlined text-amber-200/80 text-xl shrink-0">movie</span>
          <div className="min-w-0">
            <p className="text-sm text-white truncate">{fileName}</p>
            <p className="text-[11px] text-zinc-500 font-mono">
              {duration !== null ? formatDuration(duration) : "—"}
              {fileSizeBytes !== null && <> · {formatBytes(fileSizeBytes)}</>} · {ratio}
            </p>
          </div>
        </div>
        <button
          onClick={onReset}
          className="shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 transition-all text-zinc-300 cursor-pointer"
        >
          Replace
        </button>
      </div>

      {/* The one persistent preview surface — real footage the entire time, never a placeholder graphic. */}
      <div className={`${previewShapeClass} rounded-3xl bg-black border border-white/10 relative overflow-hidden shadow-cf-card`}>
        {previewSrc && (
          <video
            key={previewSrc}
            src={previewSrc}
            controls={isReady}
            playsInline
            className="w-full h-full object-contain bg-black"
            onLoadedMetadata={(e) => onDurationLoaded(e.currentTarget.duration)}
          />
        )}

        {isProcessing && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center space-y-4 px-6 text-center">
            <div className="w-10 h-10 rounded-full border-2 border-amber-300/50 border-t-transparent animate-spin" />
            <p className="text-sm text-zinc-200 font-body">{statusMessage ?? "Working on your clip…"}</p>
            <div className="w-48 h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-300 to-amber-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {isFailed && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px] flex flex-col items-center justify-center space-y-2 px-6 text-center">
            <span className="material-symbols-outlined text-red-400 text-2xl">error</span>
            <p className="text-sm text-red-300 font-body max-w-xs">{errorMessage ?? "Something went wrong while processing your clip."}</p>
          </div>
        )}
      </div>

      {/* Structural placeholder for the future clip/edit timeline — a single real block for the
          one clip that exists today, sized and framed so a multi-clip timeline can grow into
          this exact spot later without a layout rework. */}
      {hasClip && (
        <div className="rounded-2xl border border-white/[0.08] bg-[#121216]/60 px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">Timeline</p>
          <div className="flex items-stretch gap-2">
            <div className="flex-1 h-12 rounded-xl bg-white/[0.05] border border-white/10 flex items-center px-3.5">
              <span className="text-xs text-zinc-300 truncate">{fileName}</span>
            </div>
            <div className="w-12 h-12 rounded-xl border border-dashed border-white/10" />
          </div>
        </div>
      )}
    </div>
  );
}
