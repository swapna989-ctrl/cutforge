"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Playfair_Display } from "next/font/google";
import { useAuth } from "@/lib/auth";
import { useBilling } from "@/lib/billing";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

/**
 * Visual redesign only — same real useAuth/useBilling/usePathname wiring as before, just
 * restyled to CutForge's warm-editorial look. The slide-out drawer's nav items with no real
 * destination yet (Automations, Analytics, Social Accounts, Calendar) are shown for visual
 * consistency with the reference design but aren't links — no route exists for them yet.
 */
export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const billing = useBilling();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  const creditsLabel = billing.hasActivePlan ? "Plan active" : `${billing.freeCredits + billing.paidCredits} credits`;

  const realNavItems = [
    { href: "/dashboard", label: "Home", icon: "home" },
    { href: "/settings", label: "Settings", icon: "tune" },
  ];
  const placeholderNavItems = [
    { label: "Automations", icon: "route" },
    { label: "Analytics", icon: "bar_chart" },
    { label: "Social Accounts", icon: "alternate_email" },
    { label: "Calendar", icon: "calendar_today" },
  ];

  return (
    <div className="min-h-screen bg-[#FAF8F7]">
      <header className="sticky top-0 z-40 w-full px-4 sm:px-6 h-16 flex items-center justify-between gap-3 bg-white border-b border-[#ECE5E6]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            className="w-9 h-9 -ml-1 rounded-xl flex items-center justify-center text-[#1d1b1e] hover:bg-[#fdd5e1]/40 active:scale-95 transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[24px]">menu</span>
          </button>
          <Link href="/dashboard" className={`${playfair.className} text-lg font-semibold text-[#9a4153] tracking-tight`}>
            CutForge
          </Link>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {billing.ready && (
            <Link
              href="/pricing"
              className="hidden sm:flex items-center gap-1.5 bg-[#fdd5e1]/60 border border-[#ECE5E6] px-3 py-1.5 rounded-full text-xs font-semibold text-[#9a4153] hover:bg-[#fdd5e1] transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">auto_fix_high</span>
              <span>{creditsLabel}</span>
            </Link>
          )}

          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="w-9 h-9 rounded-full border border-[#ECE5E6] bg-white hover:bg-[#FAF8F7] flex items-center justify-center text-[#7B7579] cursor-pointer transition-colors"
              aria-label="Account menu"
            >
              <span className="material-symbols-outlined text-[18px]">person</span>
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-11 z-20 w-48 rounded-2xl border border-[#ECE5E6] bg-white shadow-[0_12px_32px_-6px_rgba(42,39,42,0.12)] py-1.5">
                  {user && (
                    <div className="px-3.5 py-2 border-b border-[#ECE5E6] mb-1">
                      <p className="text-xs text-[#1d1b1e] truncate">{user.email}</p>
                    </div>
                  )}
                  <Link href="/pricing" className="block px-3.5 py-2 text-xs text-[#544244] hover:bg-[#FAF8F7] transition-colors">
                    Pricing
                  </Link>
                  <Link href="/settings" className="block px-3.5 py-2 text-xs text-[#544244] hover:bg-[#FAF8F7] transition-colors">
                    Settings
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-3.5 py-2 text-xs text-[#7B7579] hover:bg-[#FAF8F7] hover:text-[#EF4444] transition-colors cursor-pointer"
                  >
                    Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {drawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => setDrawerOpen(false)} />
          <aside className="fixed top-0 left-0 h-full w-[82%] max-w-[320px] bg-white z-50 shadow-[8px_0_40px_-4px_rgba(33,25,28,0.22)] flex flex-col border-r border-[#ECE5E6]">
            <div className="flex items-center justify-between px-4 h-16 border-b border-[#ECE5E6] shrink-0">
              <span className={`${playfair.className} text-lg font-semibold text-[#9a4153]`}>CutForge</span>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#7B7579] hover:bg-[#FAF8F7] transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {user && (
              <div className="px-4 pt-4 shrink-0">
                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-[#FAF8F7] border border-[#ECE5E6]">
                  <div className="w-9 h-9 rounded-full bg-[#fdd5e1] text-[#9a4153] font-bold text-sm flex items-center justify-center shrink-0">
                    {(user.name || user.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#1d1b1e] truncate">{user.name || "Your account"}</p>
                    <p className="text-xs text-[#7B7579] truncate">{user.email}</p>
                  </div>
                </div>
              </div>
            )}

            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              {realNavItems.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      active ? "bg-[#fdd5e1] text-[#9a4153] font-semibold" : "text-[#1d1b1e] hover:bg-[#FAF8F7]"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
              <Link
                href="/pricing"
                onClick={() => setDrawerOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[#1d1b1e] hover:bg-[#FAF8F7] transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">bolt</span>
                <span>Pricing</span>
              </Link>

              {/* Not real features yet — visible for visual consistency with the reference
                  design, deliberately non-interactive rather than linking anywhere. */}
              <div className="pt-2 mt-2 border-t border-[#ECE5E6]">
                {placeholderNavItems.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[#B3ACA6] cursor-default select-none"
                  >
                    <span className="material-symbols-outlined text-[20px] text-[#D8D0CE]">{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </nav>

            <div className="p-3.5 border-t border-[#ECE5E6] shrink-0">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[#7B7579] hover:bg-[#FAF8F7] hover:text-[#EF4444] transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">logout</span>
                <span>Log out</span>
              </button>
            </div>
          </aside>
        </>
      )}

      <main className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-24">{children}</main>
    </div>
  );
}
