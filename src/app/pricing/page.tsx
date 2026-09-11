"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";
import { useRequireAuth } from "@/lib/auth";
import { useBilling, type Plan } from "@/lib/billing";

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
    <AppShell>
      <div className="mb-10 text-center max-w-2xl mx-auto">
        <p className="text-xs font-mono tracking-widest text-amber-300/80 uppercase mb-2">Studio Plans</p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-white">Pricing</h1>
        <p className="text-sm text-zinc-400 font-body mt-2">
          Prices shown in INR, inclusive of 18% GST. This is a demo checkout — no real payment gateway is connected yet, purchases here just
          update your local demo account instantly.
        </p>
      </div>

      <div className="bg-[#121216]/90 border border-white/[0.08] rounded-2xl px-6 py-4 mb-10 max-w-2xl mx-auto flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
        <span className="text-zinc-400">
          Free credits: <span className="text-white font-semibold">{billing.freeCredits}</span>
        </span>
        <span className="text-zinc-600">•</span>
        <span className="text-zinc-400">
          Paid credits: <span className="text-white font-semibold">{billing.paidCredits}</span>
        </span>
        <span className="text-zinc-600">•</span>
        <span className="text-zinc-400">
          Plan: <span className="text-amber-200 font-semibold">{PLAN_LABEL[billing.plan]}</span>
        </span>
        {billing.hasActivePlan && (
          <button onClick={handleCancelPlan} className="text-xs text-zinc-500 hover:text-red-400 underline underline-offset-2 cursor-pointer">
            Cancel plan
          </button>
        )}
      </div>

      {actionError && <p className="text-center text-xs text-red-400 mb-8 max-w-2xl mx-auto">{actionError}</p>}

      <section className="mb-14">
        <h2 className="font-display text-xl font-semibold text-white mb-1 text-center">Credit packs</h2>
        <p className="text-xs text-zinc-400 font-body mb-6 text-center">
          One-time purchase, no auto-renewal. Each export (with no watermark) uses 1 credit.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {CREDIT_PACKS.map((pack) => {
            const key = `pack-${pack.credits}`;
            return (
              <div key={key} className="bg-[#121216]/90 border border-white/[0.08] rounded-2xl p-6 flex flex-col text-center relative">
                {pack.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-300 font-mono text-[9px] tracking-widest font-semibold uppercase whitespace-nowrap">
                    {pack.badge}
                  </span>
                )}
                <span className="font-display text-3xl font-semibold text-white mt-2">{pack.credits}</span>
                <span className="text-xs text-zinc-500 font-mono uppercase tracking-wide mb-4">credits</span>
                <span className="text-2xl font-display font-semibold text-amber-200 mb-5">₹{pack.price}</span>
                <button
                  onClick={() => handleBuyPack(key, pack.credits)}
                  className="mt-auto py-2.5 rounded-full text-xs font-bold bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 hover:shadow-cf-pill-lg transition-all duration-300 cursor-pointer"
                >
                  {purchased === key ? "Added ✓" : "Buy now (demo)"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="font-display text-xl font-semibold text-white mb-1 text-center">Subscriptions</h2>
        <p className="text-xs text-zinc-400 font-body mb-6 text-center">Unlimited watermark-free exports for as long as your plan is active.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {SUBSCRIPTIONS.map((sub) => {
            const isCurrent = billing.plan === sub.plan;
            return (
              <div
                key={sub.plan}
                className={`bg-[#121216]/90 border rounded-2xl p-6 flex flex-col text-center relative ${
                  sub.badge === "Most popular" ? "border-amber-300/30" : "border-white/[0.08]"
                }`}
              >
                {sub.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-300 font-mono text-[9px] tracking-widest font-semibold uppercase whitespace-nowrap">
                    {sub.badge}
                  </span>
                )}
                <span className="font-display text-lg font-semibold text-white mt-2">{sub.label}</span>
                <div className="my-4">
                  <span className="text-2xl font-display font-semibold text-amber-200">{sub.price}</span>
                  <span className="text-xs text-zinc-500 font-mono">{sub.cadence}</span>
                </div>
                <ul className="space-y-1.5 text-xs text-zinc-400 font-body mb-5 text-left">
                  <li className="flex items-center space-x-2">
                    <span className="material-symbols-outlined text-[14px] text-emerald-400">check</span>
                    <span>Unlimited exports</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <span className="material-symbols-outlined text-[14px] text-emerald-400">check</span>
                    <span>No watermark</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <span className="material-symbols-outlined text-[14px] text-emerald-400">check</span>
                    <span>Priority processing</span>
                  </li>
                </ul>
                <button
                  disabled={isCurrent}
                  onClick={() => handleSubscribe(sub.plan)}
                  className={`mt-auto py-2.5 rounded-full text-xs font-bold transition-all duration-300 ${
                    isCurrent
                      ? "bg-white/[0.06] text-zinc-500 cursor-not-allowed"
                      : "bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 hover:shadow-cf-pill-lg cursor-pointer"
                  }`}
                >
                  {isCurrent ? "Current plan" : purchased === sub.plan ? "Subscribed ✓" : "Subscribe (demo)"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}
