"use client";

import Link from "next/link";
import NavDrawer, { BrandMark } from "@/components/NavDrawer";
import { useBilling } from "@/lib/billing";
import { TIER_LABEL } from "@/lib/pricing";

/**
 * Visual redesign only — same real useAuth/useBilling/usePathname wiring as before, just
 * restyled to Flovura's warm-editorial look. The nav drawer itself lives in NavDrawer.tsx,
 * shared with WorkspaceShell so every screen gets the same real navigation.
 */
export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const billing = useBilling();
  const creditsLabel = billing.hasActivePlan
    ? `${TIER_LABEL[billing.planTier]} · ${billing.planCredits} left`
    : `${billing.freeCredits + billing.paidCredits} credits`;

  return (
    <div className="min-h-screen bg-[#FAF8F7]">
      <header className="sticky top-0 z-40 w-full px-4 sm:px-6 h-16 flex items-center justify-between gap-3 bg-white border-b border-[#ECE5E6]">
        <div className="flex items-center gap-2">
          <NavDrawer />
          <BrandMark />
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
        </div>
      </header>

      <main className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-24">{children}</main>
    </div>
  );
}
