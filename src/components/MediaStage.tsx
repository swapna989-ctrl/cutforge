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

export type ClipStripItem = {
  /** The real project_clips row id — stable identity for remove/replace to target. */
  id: string;
  fileName: string;
  position: number;
  /** A real, playable source for this clip — a local blob: URL for a just-picked file, or null
   *  when resuming a project with no local file in memory. Never a fabricated placeholder. */
  previewUrl: string | null;
};

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
  clips,
  reviewing,
  onFiles,
  onReset,
  onDurationLoaded,
  onRemoveClip,
  onReplaceClip,
  onAddClips,
  onProcess,
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
  clips: ClipStripItem[];
  /** True once every selected clip has been uploaded and recorded, but before the user has
   *  confirmed processing — the window where remove/replace/add are actually available. */
  reviewing: boolean;
  onFiles: (files: File[]) => void;
  onReset: () => void;
  onDurationLoaded: (seconds: number) => void;
  onRemoveClip: (position: number) => void;
  onReplaceClip: (position: number, file: File) => void;
  onAddClips: (files: File[]) => void;
  onProcess: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const [dragOver, setDragOver] = useState(false);

  const isIdle = status === "idle";
  const isProcessing = !reviewing && (status === "ingesting" || status === "queued" || status === "synthesizing");
  const isReady = status === "ready";
  const isFailed = status === "failed";
  const hasClip = !isIdle;

  // Empty state: the dropzone IS the workspace — full-bleed, not a card competing for space.
  if (isIdle) {
    return (
      <div
        className={`rounded-[32px] border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center text-center px-6 py-24 sm:py-32 cursor-pointer ${
          dragOver ? "border-[#A8724A]/60 bg-[#A8724A]/[0.05]" : "border-[#DED6C4] hover:border-[#A8724A]/50 bg-white"
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
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length > 0) onFiles(files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onFiles(files);
            e.target.value = "";
          }}
        />
        <div className="w-16 h-16 rounded-full bg-[#F5F1EA] border border-[#E8E2D6] flex items-center justify-center mb-5">
          <span className="material-symbols-outlined text-[#A8724A] text-3xl">movie</span>
        </div>
        <h2 className="font-display text-xl sm:text-2xl font-semibold text-[#2B2926] mb-1.5">Drop your footage here</h2>
        <p className="text-sm text-[#8A8375] font-body">or tap to browse — Flovura handles the rest</p>
      </div>
    );
  }

  const previewShapeClass =
    ratio === "9:16" ? "aspect-[9/16] max-h-[62vh] sm:max-h-[68vh] mx-auto" : "aspect-video w-full max-w-3xl mx-auto";

  return (
    <div className="space-y-4">
      {/* Media strip: real facts about the actual file, a Replace action, nothing invented. */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#E8E2D6] bg-white shadow-[0_1px_2px_rgba(43,41,38,0.04)] px-4 py-3">
        <div className="flex items-center space-x-3 min-w-0">
          <span className="material-symbols-outlined text-[#A8724A] text-xl shrink-0">movie</span>
          <div className="min-w-0">
            <p className="text-sm text-[#2B2926] truncate">{fileName}</p>
            <p className="text-[11px] text-[#8A8375] font-mono">
              {duration !== null ? formatDuration(duration) : "—"}
              {fileSizeBytes !== null && <> · {formatBytes(fileSizeBytes)}</>} · {ratio}
              {clips.length > 1 && <> · {clips.length} clips</>}
            </p>
          </div>
        </div>
        <button
          onClick={onReset}
          className="shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-full border border-[#E8E2D6] bg-[#F5F1EA] hover:bg-[#EFE8DA] hover:border-[#D8D0C0] transition-all text-[#5C5648] cursor-pointer"
        >
          Replace
        </button>
      </div>

      {/* The one persistent preview surface — real footage the entire time, never a placeholder graphic.
          This is the hero of the workspace: a clean, quiet frame with no competing chrome. */}
      <div className={`${previewShapeClass} rounded-3xl bg-black border border-[#E8E2D6] relative overflow-hidden shadow-[0_24px_60px_-24px_rgba(43,41,38,0.35)]`}>
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
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] flex flex-col items-center justify-center space-y-4 px-6 text-center">
            <div className="w-10 h-10 rounded-full border-2 border-[#C99872]/40 border-t-[#C99872] animate-spin" />
            <p className="text-sm text-white/90 font-body">{statusMessage ?? "Working on your clip…"}</p>
            <div className="w-48 h-1 rounded-full bg-white/15 overflow-hidden">
              <div
                className="h-full bg-[#C99872] rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {isFailed && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center space-y-2 px-6 text-center">
            <span className="material-symbols-outlined text-[#E29B85] text-2xl">error</span>
            <p className="text-sm text-[#EFC3B3] font-body max-w-xs">{errorMessage ?? "Something went wrong while processing your clip."}</p>
          </div>
        )}
      </div>

      {/* Each uploaded clip as its own item, in upload order — a real thumbnail when we have the
          actual file in memory (just picked, this session), a plain icon when resuming a project
          with no local file to draw from. While reviewing, this is a plain selection tray: remove
          (×) and replace (↻) per clip, plus Add — no trim, reorder, or drag, and nothing here
          triggers processing on its own. */}
      {hasClip && clips.length > 0 && (
        <div className="rounded-2xl border border-[#E8E2D6] bg-white shadow-[0_1px_2px_rgba(43,41,38,0.04)] px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-[#B0A996] mb-2">
            {clips.length > 1 ? `${clips.length} Clips` : "Clip"}
            {reviewing && " · Review"}
          </p>
          <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
            {clips.map((clip) => (
              <div
                key={clip.id}
                className="relative shrink-0 w-28 h-16 rounded-xl bg-[#F5F1EA] border border-[#E8E2D6] overflow-hidden"
              >
                {clip.previewUrl ? (
                  <video src={clip.previewUrl} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[#B0A996] text-lg">movie</span>
                  </div>
                )}
                <div className="absolute top-1 left-1 min-w-4 h-4 px-1 rounded-full bg-[#2B2926]/75 flex items-center justify-center">
                  <span className="text-[9px] font-mono text-white">{clip.position + 1}</span>
                </div>

                {reviewing && (
                  <button
                    onClick={() => onRemoveClip(clip.position)}
                    aria-label={`Remove clip ${clip.position + 1}`}
                    title="Remove"
                    className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[#2B2926]/75 flex items-center justify-center text-white/80 hover:text-white hover:bg-[#B0503E]/90 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[11px]">close</span>
                  </button>
                )}

                <p className="absolute bottom-0 inset-x-0 px-1.5 py-1 text-[10px] text-white truncate bg-gradient-to-t from-black/75 to-transparent pr-5">
                  {clip.fileName}
                </p>

                {reviewing && (
                  <>
                    <button
                      onClick={() => replaceInputRefs.current[clip.position]?.click()}
                      aria-label={`Replace clip ${clip.position + 1}`}
                      title="Replace"
                      className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-[#2B2926]/75 flex items-center justify-center text-white/80 hover:text-[#E8C9AE] transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[11px]">sync</span>
                    </button>
                    <input
                      ref={(el) => {
                        replaceInputRefs.current[clip.position] = el;
                      }}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onReplaceClip(clip.position, file);
                        e.target.value = "";
                      }}
                    />
                  </>
                )}
              </div>
            ))}

            {reviewing ? (
              <div
                onClick={() => addInputRef.current?.click()}
                className="shrink-0 w-16 h-16 rounded-xl border border-dashed border-[#D8D0C0] hover:border-[#A8724A]/50 bg-[#FAF7F2] flex flex-col items-center justify-center cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-[#A8724A] text-base">add</span>
                <span className="text-[9px] text-[#8A8375] mt-0.5">Add</span>
                <input
                  ref={addInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 0) onAddClips(files);
                    e.target.value = "";
                  }}
                />
              </div>
            ) : (
              <div className="shrink-0 w-10 h-16 rounded-xl border border-dashed border-[#E8E2D6]" />
            )}
          </div>

          {reviewing && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={onProcess}
                className="py-2 px-5 rounded-full text-xs font-bold transition-colors duration-300 bg-[#A8724A] hover:bg-[#8F5D3A] text-white shadow-[0_1px_2px_rgba(43,41,38,0.15)] cursor-pointer"
              >
                Process {clips.length > 1 ? `${clips.length} clips` : "clip"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
