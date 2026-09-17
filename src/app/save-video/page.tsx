"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

// Reached only from deliverDownload's iOS fallback (src/lib/download.ts) — a real playable video
// URL (no attachment disposition) gets wrapped in this page instead of navigated to directly, so
// there's somewhere for the "long-press to save" instruction to actually live. A bare navigation
// to the raw video opened the same native player with no room for that text, which a real user
// hit: they landed on a playing video with no idea long-press was the intended next step.
function SaveVideoContent() {
  const searchParams = useSearchParams();
  const src = searchParams.get("src");

  if (!src) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF8F7] px-6">
        <p className="text-sm text-[#7B7579]">This link has expired — go back and tap Download again.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAF8F7] px-6 py-10 gap-5">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-[#1d1b1e] mb-1.5">Save your clip</h1>
        <p className="text-sm text-[#7B7579]">
          Tap and hold the video below, then choose <span className="font-medium text-[#544244]">Save Video</span> to add
          it to your Photos.
        </p>
      </div>
      <video
        src={src}
        controls
        playsInline
        className="w-full max-w-sm rounded-2xl shadow-[0_8px_24px_-4px_rgba(42,39,42,0.12)] bg-black"
      />
    </div>
  );
}

export default function SaveVideoPage() {
  return (
    <Suspense fallback={null}>
      <SaveVideoContent />
    </Suspense>
  );
}
