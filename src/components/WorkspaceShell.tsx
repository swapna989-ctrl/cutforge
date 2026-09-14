"use client";

import Link from "next/link";
import NavDrawer, { BrandMark } from "@/components/NavDrawer";
import type { PipelineStatus } from "@/lib/pipeline";

/**
 * Same top brand row + hamburger drawer as every other shell (via NavDrawer/BrandMark) — a
 * project mid-workspace shouldn't be a dead end with no way back to Home/Settings/Sign out.
 * Below that, a standalone "Back to Projects" row, matching the reference layout.
 */
export default function WorkspaceShell({ status, children }: { status: PipelineStatus; children: React.ReactNode }) {
  const statusLabel =
    status === "ready"
      ? { text: "Ready", cls: "text-[#5B8C6E]" }
      : status === "failed"
        ? { text: "Failed", cls: "text-[#B0503E]" }
        : status === "idle"
          ? { text: "Draft", cls: "text-[#B0A996]" }
          : { text: "Working…", cls: "text-[#A8724A]" };

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <header className="sticky top-0 z-50 w-full bg-[#FAF7F2]/90 backdrop-blur-xl border-b border-[#E8E2D6]">
        <div className="px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <NavDrawer />
            <BrandMark />
          </div>
          <span className={`text-[11px] font-mono uppercase tracking-wide shrink-0 ${statusLabel.cls}`}>{statusLabel.text}</span>
        </div>

        <div className="px-4 sm:px-6 py-3">
          <Link
            href="/clipping"
            className="flex items-center gap-2 text-base text-[#1d1b1e] hover:text-[#A8724A] transition-colors w-fit"
          >
            <span className="material-symbols-outlined text-[22px]">arrow_back</span>
            <span>Back to Projects</span>
          </Link>
        </div>
      </header>

      <main className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-24">{children}</main>
    </div>
  );
}
