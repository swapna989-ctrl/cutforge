"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Playfair_Display } from "next/font/google";
import DashboardShell from "@/components/DashboardShell";
import { useRequireAuth } from "@/lib/auth";
import { listProjects } from "@/lib/projects";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600", "700"], style: ["normal", "italic"] });

const FEATURES = [
  {
    icon: "content_cut",
    title: "AI Hook Detection",
    body: "Finds the strongest, most self-contained moments in your footage and scores each one for how well it'll land as a short.",
    cta: "Start clipping",
    live: true,
  },
  {
    icon: "crop_portrait",
    title: "Vertical Auto-Crop",
    body: "Every short is automatically reframed to 9:16 or 16:9, ready to post without any manual cropping.",
    cta: "See it in action",
    live: true,
  },
  {
    icon: "closed_caption",
    title: "Kinetic Auto-Captions",
    body: "Short, punchy caption bursts synced word-by-word to your speech — white text, bold outline, bottom-third placement.",
    cta: "Explore caption style",
    live: true,
  },
  {
    icon: "calendar_month",
    title: "Multi-Platform Publishing",
    body: "Post directly to TikTok, Reels, and YouTube Shorts from CutForge.",
    cta: "Coming soon",
    live: false,
  },
];

export default function DashboardHomePage() {
  const router = useRouter();
  const { ready, user } = useRequireAuth();
  const [projectCount, setProjectCount] = useState<number | null>(null);

  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    listProjects()
      .then((data) => {
        if (!cancelled) setProjectCount(data.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  if (!ready || !user) return null;

  return (
    <DashboardShell>
      <section className="pt-2 space-y-3 mb-6">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#fdd5e1]/60 text-[#9a4153] text-[11px] font-semibold tracking-wide">
          <span className="w-1.5 h-1.5 rounded-full bg-[#ed8395] animate-pulse" />
          <span>Intelligent short-form engine</span>
        </div>
        <h1 className={`${playfair.className} text-3xl sm:text-4xl font-semibold text-[#1d1b1e] tracking-tight leading-tight`}>
          Turn long videos into <span className="italic text-[#9a4153]">viral moments.</span>
        </h1>
        <p className="text-sm text-[#7B7579] leading-relaxed max-w-md">
          CutForge finds the highest-retention moments in your footage and turns them into ready-to-post shorts —
          captioned, cropped, and scored.
        </p>
      </section>

      {/* Primary CTA banner — the one real action on this page. */}
      <section className="mb-8 bg-white border border-[#ECE5E6] rounded-3xl p-5 shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-[#fdd5e1]/50 rounded-full blur-2xl pointer-events-none" />
        <div className="relative w-full aspect-[16/9] sm:aspect-[16/7] rounded-2xl overflow-hidden mb-5 bg-gradient-to-br from-[#fdd5e1] via-[#f4ebe8] to-[#FAF8F7] border border-[#ECE5E6]/80 flex items-center justify-center shadow-inner">
          <span className="material-symbols-outlined text-[56px] text-[#9a4153]/40">content_cut</span>
          {projectCount !== null && projectCount > 0 && (
            <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-md border border-[#ECE5E6] px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-[#10B981]" />
              <span className="text-[11px] font-semibold text-[#1d1b1e]">
                {projectCount} project{projectCount === 1 ? "" : "s"} clipped so far
              </span>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <button
            onClick={() => router.push("/clipping")}
            className="w-full bg-[#ed8395] text-white py-3.5 px-6 rounded-full shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150 active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
          >
            <span className="text-sm font-semibold">Clip your first video</span>
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
          <div className="flex items-center justify-center gap-1.5 text-center pt-1">
            <span className="material-symbols-outlined text-[#7B7579] text-[14px]">check_circle</span>
            <span className="text-[11px] text-[#7B7579]">YouTube, Twitch, or MP4 / MOV uploads</span>
          </div>
        </div>
      </section>

      <div className="pt-2 flex items-center justify-between mb-4">
        <h2 className={`${playfair.className} text-xl font-semibold text-[#1d1b1e]`}>Creative Toolkit</h2>
      </div>

      <div className="space-y-4 mb-8">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="bg-white border border-[#ECE5E6] rounded-3xl p-5 shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] flex flex-col justify-between"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#F8E8EC] border border-[#f3d3dc] flex items-center justify-center shrink-0 shadow-sm">
                <span className="material-symbols-outlined text-[#9a4153] text-[24px]">{feature.icon}</span>
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-[#1d1b1e]">{feature.title}</h3>
                <p className="text-sm text-[#7B7579] leading-snug">{feature.body}</p>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-[#ECE5E6]/60 flex justify-end">
              {feature.live ? (
                <button
                  onClick={() => router.push("/clipping")}
                  className="inline-flex items-center gap-1 text-xs text-[#9a4153] font-semibold hover:text-[#ed8395] transition-colors cursor-pointer"
                >
                  <span>{feature.cta}</span>
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-[#B3ACA6] font-medium cursor-default select-none">
                  {feature.cta}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <section className="bg-[#FAF8F7] border border-[#ECE5E6] rounded-2xl p-4 flex items-center gap-3">
        <span className="material-symbols-outlined text-[#9a4153]">tips_and_updates</span>
        <p className="text-sm text-[#544244]">
          Paste a podcast or stream link to generate multiple curated shorts from one video, automatically.
        </p>
      </section>
    </DashboardShell>
  );
}
