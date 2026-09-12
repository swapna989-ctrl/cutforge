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
      ? { text: "Ready", cls: "text-emerald-400" }
      : status === "failed"
        ? { text: "Failed", cls: "text-red-400" }
        : status === "idle"
          ? { text: "Draft", cls: "text-zinc-500" }
          : { text: "Working…", cls: "text-amber-300" };

  return (
    <>
      <div className="fixed inset-0 pointer-events-none bg-radial-gradient z-0" />

      <header className="sticky top-0 z-50 w-full px-4 sm:px-6 py-3.5 bg-[#08080a]/80 backdrop-blur-xl border-b border-white/[0.06] flex items-center justify-between gap-3">
        <Link
          href="/dashboard"
          className="flex items-center space-x-1.5 text-xs font-mono text-zinc-500 hover:text-amber-200 transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          <span className="hidden sm:inline">Dashboard</span>
        </Link>

        <div className="flex-1 min-w-0 text-center">
          <span className="text-sm font-medium text-white truncate inline-block max-w-full px-2">
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
              className="flex items-center space-x-1.5 text-[11px] font-mono px-3 py-1.5 rounded-full border border-amber-400/20 bg-amber-400/[0.06] text-amber-200/90 hover:bg-amber-400/[0.12] hover:border-amber-400/30 transition-all whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-[14px]">bolt</span>
              <span>{billing.hasActivePlan ? "Plan active" : `${billing.freeCredits + billing.paidCredits}`}</span>
            </Link>
          )}

          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="w-8 h-8 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 transition-all flex items-center justify-center text-zinc-300 cursor-pointer"
              aria-label="Account menu"
            >
              <span className="material-symbols-outlined text-[18px]">person</span>
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-10 z-20 w-48 rounded-2xl border border-white/[0.08] bg-[#121216] shadow-cf-card py-1.5">
                  {user && (
                    <div className="px-3.5 py-2 border-b border-white/[0.06] mb-1">
                      <p className="text-xs text-white truncate">{user.email}</p>
                    </div>
                  )}
                  <Link
                    href="/dashboard"
                    className="block px-3.5 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                  >
                    Dashboard
                  </Link>
                  <Link
                    href="/pricing"
                    className="block px-3.5 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                  >
                    Pricing
                  </Link>
                  <Link
                    href="/settings"
                    className="block px-3.5 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                  >
                    Settings
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-3.5 py-2 text-xs text-zinc-400 hover:bg-white/[0.06] hover:text-red-400 transition-colors cursor-pointer"
                  >
                    Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-20">{children}</main>
    </>
  );
}
