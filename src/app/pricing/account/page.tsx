"use client";

import { useState } from "react";
import { Playfair_Display } from "next/font/google";
import DashboardShell from "@/components/DashboardShell";
import { useRequireAuth } from "@/lib/auth";
import { useBilling } from "@/lib/billing";
import {
  TIER_CONFIG,
  TIER_ORDER,
  TIER_LABEL,
  TIER_BLURB,
  TIER_FEATURES,
  CREDIT_PACKS,
  CREDIT_SECONDS,
  canBuyCreditPacks,
  creditsToMinutes,
  formatMinutes,
  type BillingCycle,
  type PlanTier,
} from "@/lib/pricing";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

export default function PricingPage() {
  const { ready, user } = useRequireAuth();
  const billing = useBilling();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [purchased, setPurchased] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!ready || !user) return null;

  function flash(key: string) {
    setPurchased(key);
    window.setTimeout(() => setPurchased((p) => (p === key ? null : p)), 1800);
  }

  async function handleBuyPack(key: string, amount: number) {
    setActionError(null);
    const { error } = await billing.buyCreditPack(amount);
    if (error) {
      setActionError(error);
      return;
    }
    flash(key);
  }

  async function handleSubscribe(tier: Exclude<PlanTier, "none">) {
    setActionError(null);
    const { error } = await billing.subscribe(tier, cycle);
    if (error) {
      setActionError(error);
      return;
    }
    flash(tier);
  }

  async function handleCancelPlan() {
    setActionError(null);
    const { error } = await billing.cancelPlan();
    if (error) setActionError(error);
  }

  return (
    <DashboardShell>
      <div className="mb-8 text-center max-w-2xl mx-auto">
        <h1 className={`${playfair.className} text-2xl sm:text-3xl font-semibold text-[#1d1b1e] tracking-tight`}>Pricing</h1>
        <p className="text-sm text-[#7B7579] mt-2">
          Prices shown in INR, inclusive of 18% GST. This is a demo checkout — no real payment gateway is connected yet, purchases here
          just update your account instantly.
        </p>
      </div>

      <div className="bg-white border border-[#ECE5E6] rounded-2xl px-6 py-4 mb-8 max-w-2xl mx-auto flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)]">
        <span className="text-[#7B7579]">
          Free credits: <span className="text-[#1d1b1e] font-semibold">{billing.freeCredits}</span>
        </span>
        <span className="text-[#D8D0CE]">•</span>
        <span className="text-[#7B7579]">
          Paid credits: <span className="text-[#1d1b1e] font-semibold">{billing.paidCredits}</span>
        </span>
        <span className="text-[#D8D0CE]">•</span>
        <span className="text-[#7B7579]">
          Plan:{" "}
          <span className="text-[#9a4153] font-semibold">
            {billing.hasActivePlan ? `${TIER_LABEL[billing.planTier]} · ${billing.planCredits} credits left this month` : "None"}
          </span>
        </span>
        {billing.hasActivePlan && (
          <button onClick={handleCancelPlan} className="text-xs text-[#7B7579] hover:text-[#EF4444] underline underline-offset-2 cursor-pointer">
            Cancel plan
          </button>
        )}
      </div>

      {actionError && <p className="text-center text-xs text-[#B0503E] mb-8 max-w-2xl mx-auto">{actionError}</p>}

      <section className="mb-16">
        <h2 className={`${playfair.className} text-xl font-semibold text-[#1d1b1e] mb-1 text-center`}>Subscriptions</h2>
        <p className="text-xs text-[#7B7579] mb-5 text-center max-w-md mx-auto">
          A monthly allowance of source-video minutes to clip, watermark-free — submitting a video uses minutes in proportion to its
          real length and unlocks as many AI-planned shorts as your footage supports.
        </p>

        <div className="flex justify-center mb-8">
          <div className="inline-flex items-center p-1 rounded-full bg-white border border-[#ECE5E6] shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04)]">
            {(["monthly", "yearly"] as BillingCycle[]).map((c) => (
              <button
                key={c}
                onClick={() => setCycle(c)}
                className={`text-xs font-semibold px-4 py-1.5 rounded-full transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                  cycle === c ? "bg-[#ed8395] text-white" : "text-[#7B7579] hover:text-[#1d1b1e]"
                }`}
              >
                <span>{c === "monthly" ? "Monthly" : "Yearly"}</span>
                {c === "yearly" && (
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                      cycle === "yearly" ? "bg-white/25 text-white" : "bg-[#fdd5e1] text-[#9a4153]"
                    }`}
                  >
                    Save 30%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-5xl mx-auto items-stretch">
          {TIER_ORDER.map((tier) => {
            const cfg = TIER_CONFIG[tier];
            const isCurrent = billing.planTier === tier;
            const price = cycle === "monthly" ? cfg.priceMonthly : cfg.priceYearlyPerMonth;
            return (
              <div
                key={tier}
                className={`bg-white rounded-3xl p-6 flex flex-col text-center relative shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] ${
                  tier === "creator" ? "border-2 border-[#ed8395]" : "border border-[#ECE5E6]"
                }`}
              >
                {tier === "creator" && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-[#fdd5e1] text-[#9a4153] text-[10px] tracking-wide font-semibold uppercase whitespace-nowrap">
                    Most popular
                  </span>
                )}
                <span className="text-lg font-semibold text-[#1d1b1e] mt-2">{TIER_LABEL[tier]}</span>
                <p className="text-xs text-[#7B7579] mt-1 mb-4">{TIER_BLURB[tier]}</p>
                <div className="mb-1">
                  <span className="text-2xl font-semibold text-[#9a4153]">₹{price.toLocaleString("en-IN")}</span>
                  <span className="text-xs text-[#7B7579]"> / month</span>
                </div>
                {cycle === "yearly" && (
                  <p className="text-[11px] text-[#7B7579] mb-3">₹{cfg.priceYearlyTotal.toLocaleString("en-IN")} billed yearly</p>
                )}
                {cycle === "monthly" && <p className="text-[11px] text-[#7B7579] mb-3">billed monthly</p>}
                <p className="text-sm font-semibold text-[#1d1b1e] mb-1">
                  {formatMinutes(creditsToMinutes(cfg.monthlyCredits))}
                  <span className="text-[#7B7579] font-normal text-xs"> of video / month</span>
                </p>
                <p className="text-[11px] text-[#7B7579] mb-4">
                  {cfg.monthlyCredits} credits · 1 credit ≈ {CREDIT_SECONDS / 60} min
                </p>
                <ul className="space-y-1.5 text-xs text-[#544244] mb-5 text-left flex-1">
                  {TIER_FEATURES[tier].map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <span className="material-symbols-outlined text-[14px] text-[#10B981] mt-0.5 shrink-0">check</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  disabled={isCurrent && billing.billingCycle === cycle}
                  onClick={() => handleSubscribe(tier)}
                  className={`mt-auto py-2.5 rounded-full text-xs font-semibold transition-all duration-150 ${
                    isCurrent && billing.billingCycle === cycle
                      ? "bg-[#FAF8F7] text-[#B3ACA6] cursor-not-allowed border border-[#ECE5E6]"
                      : "bg-[#ed8395] text-white shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] cursor-pointer"
                  }`}
                >
                  {isCurrent && billing.billingCycle === cycle
                    ? "Current plan"
                    : purchased === tier
                      ? "Subscribed"
                      : isCurrent
                        ? `Switch to ${cycle}`
                        : "Subscribe (demo)"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Subscribers only -- a free-tier account never sees these (see canBuyCreditPacks). */}
      {canBuyCreditPacks(billing.planTier) && (
      <section>
        <h2 className={`${playfair.className} text-xl font-semibold text-[#1d1b1e] mb-1 text-center`}>Credit packs</h2>
        <p className="text-xs text-[#7B7579] mb-6 text-center max-w-md mx-auto">
          One-time purchase, no auto-renewal — a top-up for when you run past your plan&apos;s monthly allowance. Submitting a video uses
          credits in proportion to its real length (1 credit ≈ {CREDIT_SECONDS / 60} min) and unlocks as many AI-planned shorts as your
          footage supports, watermark-free.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-4xl mx-auto">
          {CREDIT_PACKS.map((pack) => {
            const key = `pack-${pack.credits}`;
            return (
              <div
                key={key}
                className="bg-white border border-[#ECE5E6] rounded-3xl p-6 flex flex-col text-center relative shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)]"
              >
                {pack.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-[#fdd5e1] text-[#9a4153] text-[10px] tracking-wide font-semibold uppercase whitespace-nowrap">
                    {pack.badge}
                  </span>
                )}
                <span className={`${playfair.className} text-3xl font-semibold text-[#1d1b1e] mt-2`}>{pack.credits}</span>
                <span className="text-xs text-[#7B7579] uppercase tracking-wide">credits</span>
                <span className="text-[11px] text-[#B3ACA6] mb-4">≈ {formatMinutes(creditsToMinutes(pack.credits))} of video</span>
                <span className="text-2xl font-semibold text-[#9a4153] mb-5">₹{pack.price.toLocaleString("en-IN")}</span>
                <button
                  onClick={() => handleBuyPack(key, pack.credits)}
                  className="mt-auto py-2.5 rounded-full text-xs font-semibold bg-[#ed8395] text-white shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150 cursor-pointer"
                >
                  {purchased === key ? "Added" : "Buy now (demo)"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
      )}
    </DashboardShell>
  );
}
