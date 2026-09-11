"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useAuth } from "@/lib/auth";
import { useBilling } from "@/lib/billing";

const PLAN_LABEL = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" } as const;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const billing = useBilling();

  function handleLogout() {
    logout();
    signOut({ redirect: false });
    router.push("/login");
  }

  const navLink = (href: string, label: string) => {
    const active = pathname === href || (href === "/workspace" && pathname.startsWith("/workspace"));
    return (
      <Link
        href={href}
        className={`px-3 py-1.5 rounded-full transition-all ${
          active ? "bg-white/[0.08] text-white" : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <>
      <div className="fixed inset-0 pointer-events-none bg-radial-gradient z-0" />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[700px] h-[340px] bg-amber-400/[0.04] blur-[120px] rounded-full pointer-events-none z-0" />

      <header className="sticky top-0 z-50 w-full px-6 py-4 cf-nav bg-[#08080a]/80 backdrop-blur-xl border-b border-white/[0.06] flex items-center justify-between transition-all">
        <Link href="/dashboard" className="flex items-center space-x-3 group cursor-pointer">
          <span className="tracking-[0.32em] font-black text-xl font-display text-white select-none transition-transform group-hover:scale-105 inline-block whitespace-nowrap">
            C U T F O R G E
          </span>
          <span className="hidden sm:inline-block text-[11px] font-mono tracking-widest px-2 py-0.5 rounded-full border border-amber-400/20 bg-amber-400/10 text-amber-200/90 font-medium whitespace-nowrap">
            STUDIO
          </span>
        </Link>

        <nav className="hidden md:flex items-center space-x-1 text-xs font-medium font-mono">
          {navLink("/dashboard", "Dashboard")}
          {navLink("/workspace", "New Project")}
          {navLink("/pricing", "Pricing")}
          {navLink("/settings", "Settings")}
        </nav>

        <div className="flex items-center space-x-3">
          {billing.ready && (
            <Link
              href="/pricing"
              className="flex items-center space-x-1.5 text-[11px] font-mono px-3 py-1.5 rounded-full border border-amber-400/20 bg-amber-400/[0.06] text-amber-200/90 hover:bg-amber-400/[0.12] hover:border-amber-400/30 transition-all whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-[14px]">bolt</span>
              <span>{billing.hasActivePlan ? `${PLAN_LABEL[billing.plan as keyof typeof PLAN_LABEL]} Plan` : `${billing.freeCredits + billing.paidCredits} credits`}</span>
            </Link>
          )}
          {user && <span className="hidden sm:inline-block text-[11px] font-mono text-zinc-400 truncate max-w-[140px]">{user.email}</span>}
          <button
            onClick={handleLogout}
            className="flex items-center space-x-1.5 text-[11px] font-medium px-3.5 py-1.5 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 transition-all text-zinc-300 select-none cursor-pointer"
          >
            <span className="material-symbols-outlined text-[15px]">logout</span>
            <span className="tracking-wider uppercase">Log out</span>
          </button>
        </div>
      </header>

      <main className="relative z-10 w-full max-w-7xl mx-auto px-6 pt-14 pb-24">{children}</main>
    </>
  );
}
