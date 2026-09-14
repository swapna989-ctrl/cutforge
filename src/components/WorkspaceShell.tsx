"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useBilling } from "@/lib/billing";
import type { PipelineStatus } from "@/lib/pipeline";

/**
 * A deliberately lighter top bar than AppShell's — a focused editing surface should recede its
 * own account-level chrome (dashboard/pricing/settings nav, credits pill) rather than compete
 * with the footage for attention. AppShell itself is untouched; every other page keeps its
 * current nav exactly as-is.
 */
export default function WorkspaceShell({
  projectName,
  status,
  children,
}: {
  projectName: string | null;
  status: PipelineStatus;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const billing = useBilling();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

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
        <Link
          href="/dashboard"
          className="flex items-center space-x-1.5 text-xs font-mono text-[#8A8375] hover:text-[#A8724A] transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          <span className="hidden sm:inline">Dashboard</span>
        </Link>

        <div className="flex-1 min-w-0 text-center">
          <span className="text-sm font-medium text-[#2B2926] truncate inline-block max-w-full px-2">
            {projectName ?? "New project"}
          </span>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          <span className={`hidden sm:inline text-[11px] font-mono uppercase tracking-wide ${statusLabel.cls}`}>
            {statusLabel.text}
          </span>

          {billing.ready && (
            <Link
              href="/pricing"
              className="flex items-center space-x-1.5 text-[11px] font-mono px-3 py-1.5 rounded-full border border-[#A8724A]/25 bg-[#A8724A]/[0.06] text-[#8F5D3A] hover:bg-[#A8724A]/[0.12] hover:border-[#A8724A]/35 transition-all whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-[14px]">bolt</span>
              <span>{billing.hasActivePlan ? "Plan active" : `${billing.freeCredits + billing.paidCredits}`}</span>
            </Link>
          )}

          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="w-8 h-8 rounded-full border border-[#E8E2D6] bg-white hover:bg-[#F5F1EA] hover:border-[#D8D0C0] transition-all flex items-center justify-center text-[#8A8375] cursor-pointer"
              aria-label="Account menu"
            >
              <span className="material-symbols-outlined text-[18px]">person</span>
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-10 z-20 w-48 rounded-2xl border border-[#E8E2D6] bg-white shadow-[0_12px_32px_-12px_rgba(43,41,38,0.2)] py-1.5">
                  {user && (
                    <div className="px-3.5 py-2 border-b border-[#EFEAE0] mb-1">
                      <p className="text-xs text-[#2B2926] truncate">{user.email}</p>
                    </div>
                  )}
                  <Link
                    href="/dashboard"
                    className="block px-3.5 py-2 text-xs text-[#5C5648] hover:bg-[#F5F1EA] hover:text-[#2B2926] transition-colors"
                  >
                    Dashboard
                  </Link>
                  <Link
                    href="/pricing"
                    className="block px-3.5 py-2 text-xs text-[#5C5648] hover:bg-[#F5F1EA] hover:text-[#2B2926] transition-colors"
                  >
                    Pricing
                  </Link>
                  <Link
                    href="/settings"
                    className="block px-3.5 py-2 text-xs text-[#5C5648] hover:bg-[#F5F1EA] hover:text-[#2B2926] transition-colors"
                  >
                    Settings
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-3.5 py-2 text-xs text-[#8A8375] hover:bg-[#F5F1EA] hover:text-[#B0503E] transition-colors cursor-pointer"
                  >
                    Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-24">{children}</main>
    </div>
  );
}
