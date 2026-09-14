"use client";

import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import type { PipelineStatus } from "@/lib/pipeline";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["600"], style: ["normal"] });

/**
 * A deliberately lighter top bar than DashboardShell's — a focused editing surface should
 * recede its own account-level chrome (nav, credits pill) rather than compete with the footage
 * for attention. No project name, credits, or account menu here — just the brand and a way back.
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
      <header className="sticky top-0 z-50 w-full px-4 sm:px-6 py-3.5 bg-[#FAF7F2]/90 backdrop-blur-xl border-b border-[#E8E2D6] flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 shrink-0">
          <span className={`${playfair.className} text-base font-semibold text-[#9a4153] tracking-tight`}>CutForge</span>
          <Link
            href="/clipping"
            className="flex items-center space-x-1.5 text-xs font-mono text-[#8A8375] hover:text-[#A8724A] transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            <span>Back to projects</span>
          </Link>
        </div>

        <span className={`text-[11px] font-mono uppercase tracking-wide shrink-0 ${statusLabel.cls}`}>{statusLabel.text}</span>
      </header>

      <main className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-24">{children}</main>
    </div>
  );
}
