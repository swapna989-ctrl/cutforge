"use client";

import Link from "next/link";
import type { PipelineStatus, Ratio } from "@/lib/pipeline";
import { useBilling } from "@/lib/billing";

export type ExportSnapshot = { watermarkFree: boolean; label: string };

export default function ExportCard({
  ratio,
  status,
  playing,
  downloadState,
  exportSnapshot,
  onPlay,
  onReEdit,
  onDownload,
}: {
  ratio: Ratio;
  status: PipelineStatus;
  playing: boolean;
  downloadState: "idle" | "preparing" | "done";
  exportSnapshot: ExportSnapshot | null;
  onPlay: () => void;
  onReEdit: () => void;
  onDownload: () => void;
}) {
  const isReady = status === "ready";
  const billing = useBilling();

  // While an export is in flight or just finished, freeze the watermark/credit display to what
  // was actually delivered — live billing state can change mid-flight (e.g. the last credit gets
  // spent) and shouldn't retroactively relabel a master that's already been handed to the user.
  const frozen = downloadState !== "idle" ? exportSnapshot : null;
  const effectiveWatermarkFree = frozen ? frozen.watermarkFree : billing.isWatermarkFree;
  const showWatermark = isReady && !effectiveWatermarkFree;
  const canExportNow = billing.ready && billing.canExport;
  const showUpgradeLink = isReady && downloadState === "idle" && !canExportNow;

  const badge = isReady
    ? { text: "Mastered", cls: "bg-amber-400/10 border-amber-400/20 text-amber-200" }
    : { text: "Pending", cls: "bg-white/[0.06] border-white/10 text-zinc-400" };

  return (
    <article className="bg-[#121216]/90 border border-white/[0.08] hover:border-white/[0.15] rounded-[32px] p-7 sm:p-8 flex flex-col justify-between shadow-cf-card relative overflow-hidden backdrop-blur-md group transition-all duration-300">
      <div className="absolute top-0 left-12 right-12 h-[1px] bg-gradient-to-r from-transparent via-amber-200/25 to-transparent" />

      <div className="flex justify-between items-center pb-5 border-b border-white/[0.06]">
        <div className="flex items-center space-x-2.5">
          <span className="w-6 h-6 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center font-mono text-[11px] text-amber-200/90 font-medium">
            03
          </span>
          <span className="text-xs font-medium tracking-wide uppercase text-zinc-400 font-mono">Delivery</span>
        </div>
        <span className={`px-2.5 py-1 rounded-full border font-mono text-[10px] tracking-widest font-semibold uppercase ${badge.cls}`}>
          {badge.text}
        </span>
      </div>

      <div className="my-6 flex flex-col items-center text-center">
        <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white">
          {isReady ? "Master ready." : "Awaiting synthesis."}
        </h2>
        <p className="font-body text-xs sm:text-sm text-zinc-400 mt-2 max-w-xs font-light leading-relaxed">
          {isReady
            ? "Your master is rendered at broadcast quality, framed for the canvas you chose, ready to re-edit or ship straight to your channels."
            : "Your finished master will appear here the moment synthesis wraps up."}
        </p>

        <div className="mt-7 flex items-center justify-center w-full">
          <div
            className={`${ratio === "9:16" ? "ratio-frame-9-16" : "ratio-frame-16-9"} rounded-2xl bg-black border border-white/10 p-3 flex flex-col justify-between items-center transition-all duration-500 ease-out relative overflow-hidden shadow-2xl`}
          >
            <div className="w-full flex justify-between items-center font-mono text-[10px] text-zinc-400 z-10">
              <span className="flex items-center space-x-1 text-red-400 font-medium">
                <span className={`w-2 h-2 rounded-full bg-red-500 ${isReady ? "animate-pulse" : ""}`} />
                <span>REC MASTER</span>
              </span>
              <span className="text-zinc-300">{ratio === "9:16" ? "9:16 REC.709" : "16:9 CINEMATIC"}</span>
            </div>

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-44 h-44 rounded-full border border-amber-300/20 p-2 shadow-[0_0_50px_rgba(244,213,141,0.12)] flex items-center justify-center bg-radial-gradient">
                <div className="w-36 h-36 rounded-full border border-white/15 overflow-hidden relative flex items-center justify-center bg-gradient-to-tr from-zinc-900 via-[#181820] to-amber-950/40">
                  <div className={`absolute inset-0 bg-gradient-to-t from-amber-500/20 via-transparent to-purple-500/10 mix-blend-screen ${playing ? "animate-pulse" : ""}`} />
                  <div className="text-center z-10 space-y-1">
                    <span className="tracking-[0.3em] font-display text-xs font-bold text-white block">CUTFORGE</span>
                    <span className="font-mono text-[9px] text-amber-200/70 uppercase tracking-widest block">MASTER 4K</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="z-10 my-auto">
              <button
                disabled={!isReady}
                onClick={onPlay}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-transform shadow-[0_0_24px_rgba(255,255,255,0.4)] ${
                  isReady ? "bg-white text-zinc-950 hover:scale-110 cursor-pointer" : "bg-white/20 text-white/40 cursor-not-allowed shadow-none"
                }`}
              >
                <span className="material-symbols-outlined text-2xl translate-x-[1px]">{playing ? "pause" : "play_arrow"}</span>
              </button>
            </div>

            {!isReady && (
              <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px] flex flex-col items-center justify-center space-y-1.5 z-20">
                <span className="material-symbols-outlined text-zinc-400 text-xl">lock</span>
                <span className="text-[10px] font-mono text-zinc-400 px-6 text-center">Unlocks when synthesis completes</span>
              </div>
            )}

            {showWatermark && (
              <span className="absolute bottom-9 right-2.5 z-10 px-1.5 py-0.5 rounded bg-black/50 border border-white/10 text-white/70 font-mono text-[8px] tracking-widest uppercase">
                CutForge
              </span>
            )}

            <div className="w-full flex justify-between items-center font-mono text-[10px] text-zinc-400 z-10">
              <span>3840 × 2160</span>
              <span className="text-amber-200/80">48kHz 24-BIT</span>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-white/[0.06]">
        <div className="flex items-center space-x-3">
          <button
            disabled={!isReady}
            onClick={onReEdit}
            className={`px-4 py-2.5 rounded-full text-xs font-medium border transition-all ${
              isReady
                ? "text-zinc-400 hover:text-white border-white/10 hover:border-white/20 bg-white/[0.04] cursor-pointer"
                : "text-zinc-600 border-white/[0.06] bg-white/[0.02] cursor-not-allowed"
            }`}
          >
            Re-edit
          </button>

          {showUpgradeLink ? (
            <Link
              href="/pricing"
              className="flex-1 py-2.5 px-5 rounded-full text-xs font-bold transition-all duration-300 flex items-center justify-center space-x-2 group/btn bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 hover:shadow-cf-pill-lg cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">bolt</span>
              <span>Upgrade to export</span>
            </Link>
          ) : (
            <button
              disabled={!isReady || downloadState !== "idle" || !canExportNow}
              onClick={onDownload}
              className={`flex-1 py-2.5 px-5 rounded-full text-xs font-bold transition-all duration-300 flex items-center justify-center space-x-2 group/btn disabled:cursor-not-allowed disabled:opacity-70 ${
                isReady
                  ? "bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 hover:shadow-cf-pill-lg cursor-pointer"
                  : "bg-white/10 text-white/30 shadow-none"
              }`}
            >
              <span>{downloadState === "preparing" ? "Preparing…" : downloadState === "done" ? "Downloaded ✓" : "Download Master"}</span>
              {downloadState === "idle" && (
                <span className="material-symbols-outlined text-[15px] group-hover/btn:translate-x-1 transition-transform">arrow_forward</span>
              )}
            </button>
          )}
        </div>

        {isReady && (frozen || canExportNow) && (
          <p className="text-center text-[10px] font-mono text-zinc-500 mt-2.5">
            {frozen ? (
              frozen.label
            ) : effectiveWatermarkFree ? (
              billing.hasActivePlan ? (
                "No watermark · unlimited exports on your plan"
              ) : (
                `No watermark · ${billing.paidCredits} paid credit${billing.paidCredits === 1 ? "" : "s"} left`
              )
            ) : (
              <>
                Includes CutForge watermark ({billing.freeCredits} free export{billing.freeCredits === 1 ? "" : "s"} left) ·{" "}
                <Link href="/pricing" className="text-amber-200/90 hover:text-amber-200 underline underline-offset-2">
                  Remove it
                </Link>
              </>
            )}
          </p>
        )}
      </div>
    </article>
  );
}
