"use client";

import type { Ratio } from "@/lib/pipeline";

const RATIO_OPTIONS: { value: Ratio; label: string; sub: string; platforms: string }[] = [
  { value: "9:16", label: "Vertical", sub: "9:16", platforms: "TikTok, Shorts, Reels" },
  { value: "1:1", label: "Square", sub: "1:1", platforms: "Instagram Feed" },
  { value: "16:9", label: "Landscape", sub: "16:9", platforms: "YouTube, Twitter" },
];

/** The actual shape each ratio produces, drawn as a real rectangle rather than a generic icon —
 *  what the card looks like IS what the output looks like. */
function RatioShape({ ratio, active }: { ratio: Ratio; active: boolean }) {
  const stroke = active ? "#ed8395" : "#D8D0CE";
  const dims: Record<Ratio, { w: number; h: number }> = {
    "9:16": { w: 20, h: 36 },
    "1:1": { w: 30, h: 30 },
    "16:9": { w: 40, h: 22.5 },
  };
  const { w, h } = dims[ratio];
  return (
    <svg width="48" height="40" viewBox="0 0 48 40" className="mx-auto">
      <rect
        x={(48 - w) / 2}
        y={(40 - h) / 2}
        width={w}
        height={h}
        rx={5}
        fill="none"
        stroke={stroke}
        strokeWidth="2.5"
      />
    </svg>
  );
}

export default function RatioPicker({ value, onChange }: { value: Ratio; onChange: (ratio: Ratio) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2.5">
        <span className="text-xs font-medium text-[#7B7579]">Output format</span>
        <span className="text-[10px] uppercase tracking-wide text-[#B3ACA6]">Select one</span>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {RATIO_OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`rounded-xl border pt-3 pb-2.5 px-2 text-center transition-all duration-150 cursor-pointer ${
                active ? "border-[#ed8395] bg-[#FDF1F3] ring-1 ring-[#ed8395]/30" : "border-[#ECE5E6] hover:border-[#D8D0CE]"
              }`}
            >
              <RatioShape ratio={opt.value} active={active} />
              <span className={`block text-xs font-semibold mt-1.5 ${active ? "text-[#9a4153]" : "text-[#1d1b1e]"}`}>{opt.label}</span>
              <span className={`block text-[10px] mt-0.5 ${active ? "text-[#9a4153]/70" : "text-[#B3ACA6]"}`}>{opt.sub}</span>
              <span className={`block text-[9.5px] leading-snug mt-1 ${active ? "text-[#9a4153]/70" : "text-[#B3ACA6]"}`}>{opt.platforms}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
