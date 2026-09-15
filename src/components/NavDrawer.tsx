"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Playfair_Display } from "next/font/google";
import { useAuth } from "@/lib/auth";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

const REAL_NAV_ITEMS = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/clipping", label: "Clipping", icon: "content_cut" },
  { href: "/pricing", label: "Go Pro", icon: "bolt" },
];

// Not real features yet — shown for visual consistency with the reference design, deliberately
// non-interactive (plain divs, not links) rather than pointing anywhere.
const PLACEHOLDER_NAV_ITEMS = [
  { label: "Automations", icon: "route" },
  { label: "Analytics", icon: "bar_chart" },
  { label: "Social Accounts", icon: "alternate_email" },
  { label: "Calendar", icon: "calendar_today" },
];

/**
 * The hamburger button + slide-out navigation drawer — shared by every shell (DashboardShell,
 * WorkspaceShell) so the same real nav (Home/Clipping/Go Pro) and account menu (Settings/Sign
 * out) show up everywhere, the same way Vugola's own hamburger appears on every screen including
 * mid-project. Self-contained: manages its own open state, needs no props.
 */
export default function NavDrawer() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // A portal target only exists once mounted in the browser — on the server (and for the one
  // render before hydration) there's no document.body to render into yet.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to "we're now in the browser post-hydration", an external fact, not derivable from props/state
    setMounted(true);
  }, []);

  // Collapse the profile dropdown whenever the drawer itself closes, so it doesn't reopen
  // still-expanded next time.
  function closeDrawer() {
    setDrawerOpen(false);
    setProfileOpen(false);
  }

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <>
      <button
        onClick={() => setDrawerOpen(true)}
        aria-label="Open navigation menu"
        className="w-9 h-9 -ml-1 rounded-xl flex items-center justify-center text-[#1d1b1e] hover:bg-[#fdd5e1]/40 active:scale-95 transition-all cursor-pointer"
      >
        <span className="material-symbols-outlined text-[24px]">menu</span>
      </button>

      {/* Rendered via a portal straight to <body> — a header with backdrop-blur (WorkspaceShell)
          creates a new containing block for any `position: fixed` descendant, which would
          otherwise trap this "full-screen" backdrop/drawer inside the header's own small box
          instead of the viewport. A portal makes that impossible regardless of what any future
          ancestor does with filters/transforms. */}
      {mounted && drawerOpen && createPortal(
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={closeDrawer} />
          <aside className="fixed top-0 left-0 h-full w-[82%] max-w-[320px] bg-white z-50 shadow-[8px_0_40px_-4px_rgba(33,25,28,0.22)] flex flex-col border-r border-[#ECE5E6]">
            <div className="flex items-center justify-between px-4 h-16 border-b border-[#ECE5E6] shrink-0">
              <span className={`${playfair.className} text-lg font-semibold text-[#9a4153]`}>Flovura</span>
              <button
                onClick={closeDrawer}
                aria-label="Close navigation menu"
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#7B7579] hover:bg-[#FAF8F7] transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {user && (
              <div className="px-4 pt-4 shrink-0">
                <button
                  onClick={() => setProfileOpen((o) => !o)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-[#FAF8F7] border border-[#ECE5E6] hover:bg-[#fdd5e1]/25 transition-colors cursor-pointer"
                  aria-expanded={profileOpen}
                >
                  <div className="w-9 h-9 rounded-full bg-[#fdd5e1] text-[#9a4153] font-bold text-sm flex items-center justify-center shrink-0">
                    {(user.name || user.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-semibold text-[#1d1b1e] truncate">{user.name || "Your account"}</p>
                    <p className="text-xs text-[#7B7579] truncate">{user.email}</p>
                  </div>
                  <span
                    className={`material-symbols-outlined text-[20px] text-[#7B7579] transition-transform shrink-0 ${profileOpen ? "rotate-180" : ""}`}
                  >
                    expand_more
                  </span>
                </button>

                {profileOpen && (
                  <div className="mt-1.5 rounded-xl border border-[#ECE5E6] bg-white overflow-hidden shadow-sm">
                    <Link
                      href="/settings"
                      onClick={closeDrawer}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-[#1d1b1e] hover:bg-[#FAF8F7] transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">tune</span>
                      <span>Settings</span>
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-[#7B7579] hover:bg-[#FAF8F7] hover:text-[#EF4444] transition-colors cursor-pointer border-t border-[#ECE5E6]"
                    >
                      <span className="material-symbols-outlined text-[18px]">logout</span>
                      <span>Sign out</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              {REAL_NAV_ITEMS.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeDrawer}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      active ? "bg-[#fdd5e1] text-[#9a4153] font-semibold" : "text-[#1d1b1e] hover:bg-[#FAF8F7]"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}

              <div className="pt-2 mt-2 border-t border-[#ECE5E6]">
                {PLACEHOLDER_NAV_ITEMS.map((item) => (
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
          </aside>
        </>,
        document.body
      )}
    </>
  );
}

/** The icon+wordmark brand mark, shared so every header presents the same real logo asset. */
export function BrandMark({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2">
      <Image src="/brand/logo.png" alt="" width={28} height={28} className="w-7 h-7 rounded-lg object-cover" priority />
      <span className={`${playfair.className} text-lg font-semibold text-[#9a4153] tracking-tight`}>Flovura</span>
    </Link>
  );
}
