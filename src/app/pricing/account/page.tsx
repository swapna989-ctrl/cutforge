"use client";

import { useState } from "react";
import Script from "next/script";
import { Playfair_Display } from "next/font/google";
import DashboardShell from "@/components/DashboardShell";
import { useRequireAuth } from "@/lib/auth";
import { useBilling } from "@/lib/billing";
import { startCheckout, type CheckoutRequest } from "@/lib/checkout";
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

// A test-mode Razorpay key means every payment here is simulated, so say so instead of letting
// anyone wonder whether a test card was really charged.
const IS_TEST_MODE = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.startsWith("rzp_test_") ?? false;

const RENEW_WINDOW_DAYS = 7;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function PricingPage() {
  const { ready, user } = useRequireAuth();
  const billing = useBilling();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [purchased, setPurchased] = useState<string | null>(null);
  // The card whose checkout is open or being confirmed, so a second click can't start another order.
  const [busy, setBusy] = useState<string | null>(null);
  // Read once, on mount: how close the plan is to ending only needs to be right when the page opens.
  const [now] = useState(() => Date.now());
  const [actionError, setActionError] = useState<string | null>(null);

  if (!ready || !user) return null;

  // A plan isn't billed automatically: it ends on this date unless it's paid for again.
  const planEndsAt = billing.hasActivePlan ? (billing.planExpiresAt ?? billing.planRenewsAt) : null;
  const daysLeft = planEndsAt ? (new Date(planEndsAt).getTime() - now) / 86_400_000 : null;
  const canRenew = daysLeft !== null && daysLeft <= RENEW_WINDOW_DAYS;

  function flash(key: string) {
    setPurchased(key);
    window.setTimeout(() => setPurchased((p) => (p === key ? null : p)), 1800);
  }

  function checkout(key: string, request: CheckoutRequest, description: string) {
    setActionError(null);
    setBusy(key);
    startCheckout(request, {
      description,
      email: user?.email ?? undefined,
      onSuccess: async () => {
        await billing.refresh();
        setBusy(null);
        flash(key);
      },
      onError: (message) => {
        setBusy(null);
        setActionError(message);
      },
      onDismiss: () => setBusy(null),
    });
  }

  function handleBuyPack(key: string, credits: number) {
    checkout(key, { kind: "credit_pack", packCredits: credits }, `${credits} credits`);
  }

  function handleSubscribe(tier: Exclude<PlanTier, "none">) {
    checkout(tier, { kind: "subscription", tier, cycle }, `${TIER_LABEL[tier]} plan (${cycle})`);
  }

  async function handleCancelPlan() {
    setActionError(null);
    const { error } = await billing.cancelPlan();
    if (error) setActionError(error);
  }

  return (
    <DashboardShell>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <div className="mb-8 text-center max-w-2xl mx-auto">
        <h1 className={`${playfair.className} text-2xl sm:text-3xl font-semibold text-[#1d1b1e] tracking-tight`}>Pricing</h1>
        <p className="text-sm text-[#7B7579] mt-2">Prices shown in INR, inclusive of 18% GST.</p>
        {IS_TEST_MODE && (
          <p className="text-xs text-[#9a4153] mt-2">Test mode: payments use Razorpay&apos;s test environment, so no real money moves.</p>
        )}
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
          {planEndsAt && <span className="text-[#7B7579]"> · active until {formatDate(planEndsAt)}</span>}
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
            const isCurrentCycle = isCurrent && billing.billingCycle === cycle;
            // The plan you're on stays disabled until it's close to ending, then it's a Renew button.
            const renewable = isCurrentCycle && canRenew;
            const disabled = busy !== null || (isCurrentCycle && !renewable);
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
                  disabled={disabled}
                  onClick={() => handleSubscribe(tier)}
                  className={`mt-auto py-2.5 rounded-full text-xs font-semibold transition-all duration-150 ${
                    isCurrentCycle && !renewable
                      ? "bg-[#FAF8F7] text-[#B3ACA6] cursor-not-allowed border border-[#ECE5E6]"
                      : "bg-[#ed8395] text-white shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  }`}
                >
                  {busy === tier
                    ? "Processing…"
                    : purchased === tier
                      ? "Subscribed"
                      : renewable
                        ? "Renew now"
                        : isCurrentCycle
                          ? "Current plan"
                          : isCurrent
                            ? `Switch to ${cycle}`
                            : "Subscribe"}
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
                  disabled={busy !== null}
                  onClick={() => handleBuyPack(key, pack.credits)}
                  className="mt-auto py-2.5 rounded-full text-xs font-semibold bg-[#ed8395] text-white shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {busy === key ? "Processing…" : purchased === key ? "Added" : "Buy now"}
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
