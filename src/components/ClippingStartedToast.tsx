"use client";

import { useEffect, useState } from "react";

/** A brief confirmation right after a project is queued — appears, sits for a few seconds, then
 *  fades. `token` changes (a fresh key, e.g. the new project's id) each time one more should show,
 *  which is what lets a second submission re-trigger this even while an earlier toast is still
 *  fading out. */
export default function ClippingStartedToast({ token }: { token: string | null }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!token) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [token]);

  if (!token) return null;

  return (
    <div
      className={`fixed top-5 left-1/2 -translate-x-1/2 z-[60] transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
      }`}
    >
      <div className="flex items-start gap-3 bg-white rounded-2xl border border-[#ECE5E6] shadow-[0_12px_32px_-6px_rgba(42,39,42,0.15)] px-4 py-3 max-w-sm">
        <div className="w-8 h-8 rounded-full bg-[#fdd5e1]/70 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[18px] text-[#9a4153]">content_cut</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1d1b1e]">Clipping started!</p>
          <p className="text-xs text-[#7B7579] mt-0.5">Your video is being processed. Clips will appear below.</p>
        </div>
      </div>
    </div>
  );
}
