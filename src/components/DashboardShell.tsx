"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useBilling } from "@/lib/billing";

/**
 * A calmer top bar for the dashboard, in the same spirit as WorkspaceShell — plain text nav
 * instead of pill-shaped buttons, a quiet credits readout instead of a bordered/glowing badge.
 * AppShell itself is untouched, so pricing/settings keep their current nav exactly as-is.
 */
export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const billing = useBilling();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  const navLink = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link href={href} className={`text-sm transition-colors ${active ? "text-white" : "text-zinc-500 hover:text-zinc-300"}`}>
        {label}
      </Link>
    );
  };

  return (
    <>
      <div className="fixed inset-0 pointer-events-none bg-radial-gradient z-0" />

      <header className="sticky top-0 z-50 w-full px-4 sm:px-6 py-4 bg-[#08080a]/85 backdrop-blur-xl border-b border-white/[0.06] flex items-center justify-between gap-4">
        <Link href="/dashboard" className="text-base font-display font-semibold tracking-wide text-white shrink-0">
          CutForge
        </Link>

        <nav className="hidden md:flex items-center space-x-6">
          {navLink("/dashboard", "Projects")}
          {navLink("/pricing", "Pricing")}
          {navLink("/settings", "Settings")}
        </nav>

        <div className="flex items-center space-x-4 shrink-0">
          {billing.ready && (
            <Link href="/pricing" className="hidden sm:inline text-xs text-amber-200/80 hover:text-amber-200 transition-colors">
              {billing.hasActivePlan ? "Plan active" : `${billing.freeCredits + billing.paidCredits} credits`}
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
                    href="/pricing"
                    className="md:hidden block px-3.5 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                  >
                    Pricing
                  </Link>
                  <Link
                    href="/settings"
                    className="md:hidden block px-3.5 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors"
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

      <main className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-24">{children}</main>
    </>
  );
}
