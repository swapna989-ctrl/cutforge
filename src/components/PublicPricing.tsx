"use client";

import { useState } from "react";
import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import {
  TIER_CONFIG,
  TIER_ORDER,
  TIER_LABEL,
  TIER_BLURB,
  TIER_FEATURES,
  CREDIT_PACKS,
  CREDIT_SECONDS,
  creditsToMinutes,
  formatMinutes,
  type BillingCycle,
} from "@/lib/pricing";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

const CARD_SHADOW = "shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)]";
const CTA_CLASS =
  "mt-auto py-2.5 rounded-full text-xs font-semibold bg-[#ed8395] text-white shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150";

/** The full price list for anonymous visitors. Same numbers/features as the signed-in page (both
 *  read lib/pricing.ts), but no purchase actions -- real payments aren't connected yet, so every
 *  card leads to sign-up instead of a checkout that can't complete. */
export default function PublicPricing() {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  return (
    <>
      <div className="mb-10 text-center max-w-2xl mx-auto">
        <h1 className={`${playfair.className} text-3xl sm:text-4xl font-semibold text-[#1d1b1e] tracking-tight`}>Pricing</h1>
        <p className="text-sm text-[#7B7579] mt-3">
          Prices in INR, inclusive of 18% GST. Every plan clips watermark-free, and every new account starts with 1 free credit — no card
          required.
        </p>
        <p className="text-xs text-[#B3ACA6] mt-2">Paid plans and credit packs are launching soon.</p>
      </div>

      <section className="mb-16">
        <h2 className={`${playfair.className} text-xl font-semibold text-[#1d1b1e] mb-1 text-center`}>Subscriptions</h2>
        <p className="text-xs text-[#7B7579] mb-5 text-center max-w-md mx-auto">
          A monthly allowance of source-video minutes to clip — submitting a video uses minutes in proportion to its real length and
          unlocks as many AI-planned shorts as your footage supports.
        </p>

        <div className="flex justify-center mb-8">
          <div className="inline-flex items-center p-1 rounded-full bg-white border border-[#ECE5E6] shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04)]">
            {(["monthly", "yearly"] as BillingCycle[]).map((c) => (
              <button
                key={c}
                type="button"
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
            const price = cycle === "monthly" ? cfg.priceMonthly : cfg.priceYearlyPerMonth;
            return (
              <div
                key={tier}
                className={`bg-white rounded-3xl p-6 flex flex-col text-center relative ${CARD_SHADOW} ${
                  tier === "creator" ? "border-2 border-[#ed8395]" : "border border-[#ECE5E6]"
                }`}
              >
                {tier === "creator" && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-[#fdd5e1] text-[#9a4153] text-[10px] tracking-wide font-semibold uppercase whitespace-nowrap">
                    Most popular
                  </span>
                )}
                <h3 className="text-lg font-semibold text-[#1d1b1e] mt-2">{TIER_LABEL[tier]}</h3>
                <p className="text-xs text-[#7B7579] mt-1 mb-4">{TIER_BLURB[tier]}</p>
                <div className="mb-1">
                  <span className="text-2xl font-semibold text-[#9a4153]">₹{price.toLocaleString("en-IN")}</span>
                  <span className="text-xs text-[#7B7579]"> / month</span>
                </div>
                <p className="text-[11px] text-[#7B7579] mb-3">
                  {cycle === "yearly" ? `₹${cfg.priceYearlyTotal.toLocaleString("en-IN")} billed yearly` : "billed monthly"}
                </p>
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
                <Link href="/signup" className={CTA_CLASS}>
                  Get started free
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className={`${playfair.className} text-xl font-semibold text-[#1d1b1e] mb-1 text-center`}>Credit packs</h2>
        <p className="text-xs text-[#7B7579] mb-6 text-center max-w-md mx-auto">
          One-time purchase, no auto-renewal — a way to keep clipping past a plan&apos;s monthly allowance, or without a subscription at
          all. 1 credit ≈ {CREDIT_SECONDS / 60} min of source video.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-4xl mx-auto">
          {CREDIT_PACKS.map((pack) => (
            <div
              key={pack.credits}
              className={`bg-white border border-[#ECE5E6] rounded-3xl p-6 flex flex-col text-center relative ${CARD_SHADOW}`}
            >
              {pack.badge && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-[#fdd5e1] text-[#9a4153] text-[10px] tracking-wide font-semibold uppercase whitespace-nowrap">
                  {pack.badge}
                </span>
              )}
              <span className={`${playfair.className} text-3xl font-semibold text-[#1d1b1e] mt-2`}>{pack.credits}</span>
              <span className="text-xs text-[#7B7579] uppercase tracking-wide">credits</span>
              <span className="text-[11px] text-[#B3ACA6] mb-4">≈ {formatMinutes(creditsToMinutes(pack.credits))} of video</span>
              <span className="text-2xl font-semibold text-[#9a4153] mb-5">₹{pack.price}</span>
              <Link href="/signup" className={CTA_CLASS}>
                Get started free
              </Link>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
