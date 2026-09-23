"use client";

import { useRef, useState } from "react";
import type { CaptionStyle } from "@/lib/pipeline";

// One real, pre-rendered demo clip per style — burned in by the exact same code that renders a
// real short (worker/src/ffmpeg.ts's finalizeVideo), not a CSS approximation, so what's previewed
// here is pixel-accurate to what actually ships. Source footage: Big Buck Bunny (Blender
// Foundation, Creative Commons Attribution 3.0) — see scripts this was rendered from for how.
const STYLE_ORDER: CaptionStyle[] = ["none", "classic", "bold_yellow", "rose", "glow", "punch", "minimalist", "vlog"];

const STYLE_LABELS: Record<CaptionStyle, string> = {
  none: "No Captions",
  classic: "Classic",
  bold_yellow: "Bold Yellow",
  rose: "Rose",
  glow: "Glow",
  punch: "Punch",
  minimalist: "Minimalist",
  vlog: "Vlog",
};

function previewSrc(style: CaptionStyle, ext: "mp4" | "jpg"): string {
  return `/caption-previews/${style}.${ext}`;
}

export default function CaptionStyleCarousel({
  value,
  onChange,
}: {
  value: CaptionStyle;
  onChange: (style: CaptionStyle) => void;
}) {
  const index = Math.max(0, STYLE_ORDER.indexOf(value));
  const [hovering, setHovering] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  function go(delta: number) {
    const next = (index + delta + STYLE_ORDER.length) % STYLE_ORDER.length;
    onChange(STYLE_ORDER[next]);
  }

  const prevStyle = STYLE_ORDER[(index - 1 + STYLE_ORDER.length) % STYLE_ORDER.length];
  const nextStyle = STYLE_ORDER[(index + 1) % STYLE_ORDER.length];

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2.5">
        <span className="text-xs font-medium text-[#7B7579]">Caption style</span>
        <span className="text-[10px] uppercase tracking-wide text-[#B3ACA6]">Hover to preview</span>
      </div>

      <div className="relative flex items-center justify-center gap-2 select-none">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Previous caption style"
          className="absolute left-0 z-10 w-8 h-8 rounded-full bg-white shadow-[0_2px_8px_-1px_rgba(42,39,42,0.15)] border border-[#ECE5E6] flex items-center justify-center text-[#544244] hover:bg-[#FAF8F7] transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">chevron_left</span>
        </button>

        <div className="flex items-center justify-center gap-2 mx-10 overflow-hidden w-full max-w-[280px]">
          {/* Peeking side card — a dim sliver of the previous style, purely a "there's more" cue. */}
          <div className="hidden sm:block shrink-0 w-6 aspect-[9/16] rounded-lg overflow-hidden opacity-35 bg-[#1a1a1a]">
            <img src={previewSrc(prevStyle, "jpg")} alt="" className="w-full h-full object-cover" />
          </div>

          <div
            className="relative shrink-0 w-[136px] aspect-[9/16] rounded-xl overflow-hidden bg-[#1a1a1a] border-2 border-[#ed8395] shadow-[0_8px_24px_-4px_rgba(237,131,149,0.35)]"
            onMouseEnter={() => {
              setHovering(true);
              videoRef.current?.play().catch(() => {});
            }}
            onMouseLeave={() => {
              setHovering(false);
              videoRef.current?.pause();
            }}
          >
            <span className="absolute top-1.5 right-1.5 z-10 px-1.5 py-0.5 rounded-full bg-[#ed8395] text-white text-[9px] font-semibold tracking-wide">
              SELECTED
            </span>
            {hovering ? (
              <video
                ref={videoRef}
                key={value}
                src={previewSrc(value, "mp4")}
                poster={previewSrc(value, "jpg")}
                muted
                loop
                playsInline
                autoPlay
                className="w-full h-full object-cover"
              />
            ) : (
              <img src={previewSrc(value, "jpg")} alt={`${STYLE_LABELS[value]} preview`} className="w-full h-full object-cover" />
            )}
            <div className="absolute bottom-0 inset-x-0 py-1.5 text-center bg-gradient-to-t from-black/70 to-transparent">
              <span className="text-[11px] font-semibold text-white">{STYLE_LABELS[value]}</span>
            </div>
          </div>

          <div className="hidden sm:block shrink-0 w-6 aspect-[9/16] rounded-lg overflow-hidden opacity-35 bg-[#1a1a1a]">
            <img src={previewSrc(nextStyle, "jpg")} alt="" className="w-full h-full object-cover" />
          </div>
        </div>

        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Next caption style"
          className="absolute right-0 z-10 w-8 h-8 rounded-full bg-white shadow-[0_2px_8px_-1px_rgba(42,39,42,0.15)] border border-[#ECE5E6] flex items-center justify-center text-[#544244] hover:bg-[#FAF8F7] transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">chevron_right</span>
        </button>
      </div>

      <div className="flex items-center justify-center gap-1.5 mt-3">
        {STYLE_ORDER.map((style) => (
          <button
            key={style}
            type="button"
            onClick={() => onChange(style)}
            aria-label={`Show ${STYLE_LABELS[style]}`}
            className={`h-1.5 rounded-full transition-all duration-200 cursor-pointer ${
              style === value ? "w-5 bg-[#ed8395]" : "w-1.5 bg-[#ECE5E6] hover:bg-[#D8D0CE]"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
