"use client";

import { useState } from "react";
import { Playfair_Display } from "next/font/google";
import DashboardShell from "@/components/DashboardShell";
import { useRequireAuth } from "@/lib/auth";
import { useBilling, type Plan } from "@/lib/billing";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

const CREDIT_PACKS = [
  { credits: 10, price: 149 },
  { credits: 30, price: 349 },
  { credits: 100, price: 899, badge: "Best value per credit" },
];

const SUBSCRIPTIONS: { plan: Plan; label: string; price: string; cadence: string; badge?: string }[] = [
  { plan: "weekly", label: "Weekly", price: "₹149", cadence: "/ week" },
  { plan: "monthly", label: "Monthly", price: "₹399", cadence: "/ month", badge: "Most popular" },
  { plan: "yearly", label: "Yearly", price: "₹3,499", cadence: "/ year", badge: "Best value" },
];

const PLAN_LABEL: Record<Plan, string> = { none: "No active plan", weekly: "Weekly plan", monthly: "Monthly plan", yearly: "Yearly plan" };

export default function PricingPage() {
  const { ready, user } = useRequireAuth();
  const billing = useBilling();
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

  async function handleSubscribe(plan: Plan) {
    setActionError(null);
    const { error } = await billing.subscribe(plan);
    if (error) {
      setActionError(error);
      return;
    }
    flash(plan);
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

      <div className="bg-white border border-[#ECE5E6] rounded-2xl px-6 py-4 mb-10 max-w-2xl mx-auto flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)]">
        <span className="text-[#7B7579]">
          Free credits: <span className="text-[#1d1b1e] font-semibold">{billing.freeCredits}</span>
        </span>
        <span className="text-[#D8D0CE]">•</span>
        <span className="text-[#7B7579]">
          Paid credits: <span className="text-[#1d1b1e] font-semibold">{billing.paidCredits}</span>
        </span>
        <span className="text-[#D8D0CE]">•</span>
        <span className="text-[#7B7579]">
          Plan: <span className="text-[#9a4153] font-semibold">{PLAN_LABEL[billing.plan]}</span>
        </span>
        {billing.hasActivePlan && (
          <button onClick={handleCancelPlan} className="text-xs text-[#7B7579] hover:text-[#EF4444] underline underline-offset-2 cursor-pointer">
            Cancel plan
          </button>
        )}
      </div>

      {actionError && <p className="text-center text-xs text-[#B0503E] mb-8 max-w-2xl mx-auto">{actionError}</p>}

      <section className="mb-14">
        <h2 className={`${playfair.className} text-xl font-semibold text-[#1d1b1e] mb-1 text-center`}>Credit packs</h2>
        <p className="text-xs text-[#7B7579] mb-6 text-center max-w-md mx-auto">
          One-time purchase, no auto-renewal. Each video you submit for clipping uses 1 credit — that unlocks up to 5 AI-planned shorts
          from it, watermark-free.
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
                <span className="text-xs text-[#7B7579] uppercase tracking-wide mb-4">credits</span>
                <span className="text-2xl font-semibold text-[#9a4153] mb-5">₹{pack.price}</span>
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

      <section>
        <h2 className={`${playfair.className} text-xl font-semibold text-[#1d1b1e] mb-1 text-center`}>Subscriptions</h2>
        <p className="text-xs text-[#7B7579] mb-6 text-center max-w-md mx-auto">
          Unlimited video submissions, watermark-free, for as long as your plan is active.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-4xl mx-auto">
          {SUBSCRIPTIONS.map((sub) => {
            const isCurrent = billing.plan === sub.plan;
            return (
              <div
                key={sub.plan}
                className={`bg-white rounded-3xl p-6 flex flex-col text-center relative shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] ${
                  sub.badge === "Most popular" ? "border-2 border-[#ed8395]" : "border border-[#ECE5E6]"
                }`}
              >
                {sub.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-[#fdd5e1] text-[#9a4153] text-[10px] tracking-wide font-semibold uppercase whitespace-nowrap">
                    {sub.badge}
                  </span>
                )}
                <span className="text-lg font-semibold text-[#1d1b1e] mt-2">{sub.label}</span>
                <div className="my-4">
                  <span className="text-2xl font-semibold text-[#9a4153]">{sub.price}</span>
                  <span className="text-xs text-[#7B7579]">{sub.cadence}</span>
                </div>
                <ul className="space-y-1.5 text-xs text-[#544244] mb-5 text-left">
                  <li className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px] text-[#10B981]">check</span>
                    <span>Unlimited video submissions</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px] text-[#10B981]">check</span>
                    <span>No watermark</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px] text-[#10B981]">check</span>
                    <span>Up to 5 AI-planned shorts per video</span>
                  </li>
                </ul>
                <button
                  disabled={isCurrent}
                  onClick={() => handleSubscribe(sub.plan)}
                  className={`mt-auto py-2.5 rounded-full text-xs font-semibold transition-all duration-150 ${
                    isCurrent
                      ? "bg-[#FAF8F7] text-[#B3ACA6] cursor-not-allowed border border-[#ECE5E6]"
                      : "bg-[#ed8395] text-white shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] cursor-pointer"
                  }`}
                >
                  {isCurrent ? "Current plan" : purchased === sub.plan ? "Subscribed" : "Subscribe (demo)"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </DashboardShell>
  );
}
