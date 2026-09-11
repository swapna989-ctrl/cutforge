"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PipelineStatus, Ratio } from "@/lib/pipeline";
import { TOTAL_SHOTS } from "@/lib/pipeline";

export default function SynthesisCard({
  ratio,
  status,
  progress,
  log,
}: {
  ratio: Ratio;
  status: PipelineStatus;
  progress: number;
  log: string[];
}) {
  const isActive = status === "synthesizing";
  const isWaiting = status === "idle" || status === "ingesting";

  const badge = isWaiting
    ? { text: "Standby", cls: "bg-white/[0.06] border-white/10 text-zinc-400" }
    : isActive
      ? { text: "Editing", cls: "bg-amber-400/10 border-amber-400/30 text-amber-300" }
      : { text: "Synced", cls: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" };

  // Deterministic pseudo-random waveform (same value on server and client, avoids hydration mismatch).
  const bars = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => {
        const seed = Math.sin(i * 12.9898) * 43758.5453;
        const frac = seed - Math.floor(seed);
        return 28 + Math.round(frac * 72);
      }),
    []
  );

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const shot = isWaiting ? 0 : Math.max(1, Math.round((progress / 100) * TOTAL_SHOTS));

  return (
    <article className="bg-[#121216]/90 border border-white/[0.08] hover:border-white/[0.15] rounded-[32px] p-7 sm:p-8 flex flex-col justify-between shadow-cf-card relative overflow-hidden backdrop-blur-md group transition-all duration-300">
      <div className="absolute top-0 left-12 right-12 h-[1px] bg-gradient-to-r from-transparent via-amber-200/35 to-transparent" />

      <div className="flex justify-between items-center pb-5 border-b border-white/[0.06]">
        <div className="flex items-center space-x-2.5">
          <span
            className={`w-6 h-6 rounded-full flex items-center justify-center font-mono text-[11px] font-bold border ${
              isActive ? "bg-amber-400/20 border-amber-300/30 text-amber-200" : "bg-white/[0.06] border-white/10 text-amber-200/90"
            }`}
          >
            02
          </span>
          <span className="text-xs font-medium tracking-wide uppercase text-zinc-400 font-mono">Synthesis</span>
        </div>
        <span className={`px-2.5 py-1 rounded-full border font-mono text-[10px] tracking-widest font-semibold uppercase flex items-center space-x-1.5 ${badge.cls}`}>
          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-ping" />}
          <span>{badge.text}</span>
        </span>
      </div>

      <div className="my-6 flex flex-col items-center text-center">
        <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white">Every cut &amp; beat.</h2>
        <p className="font-body text-xs sm:text-sm text-zinc-400 mt-2 max-w-xs font-light leading-relaxed">
          The engine finds the story in your footage — trimming dead air, locking cuts to the beat, and grading color in real time.
        </p>

        <div className="mt-7 flex items-center justify-center w-full">
          <div
            className={`${ratio === "9:16" ? "ratio-frame-9-16" : "ratio-frame-16-9"} rounded-2xl bg-[#0b0b0e] border border-white/10 p-4 flex flex-col justify-between items-center transition-all duration-500 ease-out relative shadow-inner`}
          >
            <div className="w-full flex justify-between items-center font-mono text-[10px] text-zinc-400">
              <span className="text-zinc-300 font-medium">AI ACTIVITY</span>
              <span className="text-amber-200/90 font-semibold">
                {isWaiting ? "0%" : `${progress}%`} • {ratio}
              </span>
            </div>

            {/* Beat waveform with a progress playhead */}
            <div className="w-full bg-[#131317] rounded-xl border border-white/[0.06] p-2.5">
              <div className="flex items-end justify-between h-10 gap-[2px]">
                {bars.map((h, i) => {
                  // (i + 1), not i: makes the last bar light at 100% and keeps bar 0 unlit at 0%,
                  // since each bar represents the slice of progress it completes, not where it starts.
                  const barPct = ((i + 1) / bars.length) * 100;
                  const isPast = barPct <= progress;
                  return (
                    <div
                      key={i}
                      className={`waveform-bar flex-1 rounded-full ${isActive ? "is-live" : ""} ${
                        isPast ? "bg-gradient-to-t from-amber-300 to-amber-100" : "bg-white/10"
                      }`}
                      style={{ height: `${h}%` }}
                    />
                  );
                })}
              </div>
              <div className="flex items-center justify-between mt-1.5 font-mono text-[9px] text-zinc-500">
                <span>124 BPM</span>
                <span>BEAT-LOCKED</span>
              </div>
            </div>

            {/* Live AI edit activity log */}
            <div ref={logRef} className="cf-log-scroll w-full h-12 sm:h-16 my-1.5 bg-[#131317] rounded-xl border border-white/[0.06] p-2.5 text-left font-mono text-[10px] text-zinc-400 overflow-y-auto">
              {log.length === 0 ? (
                <div className="text-zinc-600 italic">Awaiting ingest…</div>
              ) : (
                log.map((line, i) => (
                  <div key={i} className="log-line flex items-start space-x-1.5 py-0.5">
                    <span className="text-amber-300/80 shrink-0">›</span>
                    <span className={i === log.length - 1 ? "text-zinc-200" : ""}>{line}</span>
                  </div>
                ))
              )}
            </div>

            {/* Progress pill */}
            <div className="w-full bg-[#16161c] p-2 rounded-full border border-white/10 flex items-center justify-between">
              <div className="h-3 w-4/5 bg-black/60 rounded-full overflow-hidden p-0.5 relative">
                <div
                  className="h-full bg-gradient-to-r from-amber-200/90 to-amber-400 rounded-full shadow-[0_0_12px_rgba(244,213,141,0.8)] relative transition-all duration-300"
                  style={{ width: `${isWaiting ? 0 : progress}%` }}
                >
                  {isActive && <div className="absolute right-0 top-0 bottom-0 w-2.5 bg-white rounded-full glow-pulse" />}
                </div>
              </div>
              <span className="text-[10px] font-mono text-zinc-300 font-semibold px-2">{isWaiting ? 0 : progress}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-white/[0.06] flex justify-between items-center text-xs font-mono text-zinc-500">
        <span>BEAT: 124 BPM LOCKED</span>
        <span className="text-amber-300 font-medium">SHOT {shot} / {TOTAL_SHOTS}</span>
      </div>
    </article>
  );
}
