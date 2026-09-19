"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Playfair_Display } from "next/font/google";
import PublicFooter from "@/components/PublicFooter";
import { TIER_CONFIG, TIER_ORDER, TIER_LABEL, TIER_BLURB, TIER_FEATURES, CREDIT_SECONDS, creditsToMinutes, formatMinutes } from "@/lib/pricing";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

const STEPS = [
  {
    title: "Upload or paste a link",
    body: "MP4, MOV, AVI, or MKV up to 5GB — or paste a YouTube or Twitch link. Videos must be 5 minutes to 3 hours long.",
    icon: "cloud_upload",
  },
  {
    title: "AI finds the moments",
    body: "Flovura transcribes your footage and plans as many clips as it genuinely supports, each with its own hook, caption, and AI-estimated viral score.",
    icon: "auto_awesome",
  },
  {
    title: "Download, ready to post",
    body: "Vertical or horizontal, captions already burned in, no watermark on paid plans.",
    icon: "download",
  },
];

const FEATURES = [
  { icon: "auto_awesome", title: "AI Clip Planner", body: "Finds the strongest moments in a long video and turns each into its own candidate short." },
  { icon: "insights", title: "Viral score", body: "Every planned clip gets an AI-estimated score, so you know which ones to post first." },
  { icon: "closed_caption", title: "Kinetic captions", body: "Word-synced captions burned directly into the video — no separate captioning step." },
  { icon: "crop", title: "Any format", body: "Export 9:16 for Shorts/Reels/TikTok, 16:9 for YouTube, or 1:1 for feed posts, from the same source." },
  { icon: "link", title: "Links or uploads", body: "Drop in a file, or paste a YouTube or Twitch link and let Flovura fetch it for you." },
  { icon: "verified", title: "No watermark", body: "Paid credits and subscriptions render clean — the free tier watermark comes off immediately." },
];

const FAQS = [
  {
    q: "How does Flovura work?",
    a: "Upload a video or paste a YouTube or Twitch link. Flovura transcribes it, plans several candidate clips with a hook and caption for each, and renders them with captions burned in — ready to download.",
  },
  {
    q: "What videos can I use?",
    a: "MP4, MOV, AVI, or MKV up to 5GB. Videos must be between 5 minutes and 3 hours long.",
  },
  {
    q: "How do credits work?",
    a: `1 credit covers up to ${CREDIT_SECONDS / 60} minutes of source video. A submission is charged for its real length, not a flat rate per video, and unlocks as many AI-planned shorts as the footage supports.`,
  },
  {
    q: "Do unused plan credits roll over?",
    a: "Starter resets to its monthly allowance each cycle. Creator and Agency roll over unused credits, up to 2x their monthly allowance.",
  },
  {
    q: "Is there a free tier?",
    a: "Yes — 1 free credit when you sign up, no card required.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes, from Settings, whenever you want.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[#ECE5E6] rounded-2xl bg-white overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left cursor-pointer"
      >
        <span className="text-sm font-semibold text-[#1d1b1e]">{q}</span>
        <span className={`material-symbols-outlined text-[18px] text-[#7B7579] shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
          expand_more
        </span>
      </button>
      {open && <p className="px-5 pb-4 text-sm text-[#7B7579] leading-relaxed">{a}</p>}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#FAF8F7]">
      <header className="sticky top-0 z-40 w-full bg-[#FAF8F7]/90 backdrop-blur-xl border-b border-[#ECE5E6]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/brand/logo.png" alt="" width={28} height={28} className="w-7 h-7 rounded-lg object-cover" priority />
            <span className={`${playfair.className} text-lg font-semibold text-[#9a4153] tracking-tight`}>Flovura</span>
          </Link>

          <nav className="hidden sm:flex items-center gap-6">
            <a href="#features" className="text-sm text-[#544244] hover:text-[#1d1b1e] transition-colors">
              Features
            </a>
            <a href="#pricing" className="text-sm text-[#544244] hover:text-[#1d1b1e] transition-colors">
              Pricing
            </a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/login" className="text-sm font-medium text-[#544244] hover:text-[#1d1b1e] transition-colors px-2">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="text-sm font-semibold text-white bg-[#ed8395] hover:bg-[#9a4153] px-4 py-2 rounded-full shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] transition-all duration-150"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#fdd5e1]/60 text-[#9a4153] text-[11px] font-semibold tracking-wide mb-5">
              <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
              <span>AI Clip Planner</span>
            </div>
            <h1 className={`${playfair.className} text-4xl sm:text-5xl font-semibold text-[#1d1b1e] tracking-tight leading-[1.1] mb-5`}>
              Drop in a video.
              <br />
              Walk away with <span className="italic text-[#9a4153]">shorts</span>.
            </h1>
            <p className="text-base text-[#7B7579] leading-relaxed max-w-md mb-8">
              Flovura finds the strongest moments in your footage, plans multiple clips with a hook and viral score for each, and burns
              in captions — ready to download and post.
            </p>
            <div className="flex items-center gap-4 flex-wrap">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 py-3 px-7 rounded-full bg-[#ed8395] text-white font-semibold text-sm shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150 active:scale-[0.98]"
              >
                <span>Start clipping free</span>
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </Link>
              <Link href="/login" className="text-sm font-medium text-[#544244] hover:text-[#1d1b1e] transition-colors">
                Already have an account?
              </Link>
            </div>
            <p className="text-xs text-[#B3ACA6] mt-4">1 free credit to start · no card required</p>
          </div>

          {/* Abstract "one long video -> three vertical shorts" illustration — not a screenshot of
              the real product, just a stylized shape of what it does. */}
          <div className="flex items-center justify-center gap-4">
            <div className="w-32 sm:w-40 aspect-video rounded-2xl bg-white border border-[#ECE5E6] shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[32px] text-[#B3ACA6]">play_circle</span>
            </div>
            <span className="material-symbols-outlined text-[22px] text-[#D8D0CE] shrink-0">arrow_forward</span>
            <div className="flex gap-2.5">
              {[87, 74, 92].map((score, i) => (
                <div
                  key={i}
                  className={`w-14 sm:w-16 aspect-[9/16] rounded-xl bg-white border border-[#ECE5E6] shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] flex flex-col justify-between p-1.5 ${
                    i === 1 ? "translate-y-3" : ""
                  }`}
                >
                  <span className="self-start px-1.5 py-0.5 rounded-full bg-[#fdd5e1] text-[#9a4153] text-[8px] font-bold">{score}</span>
                  <div className="space-y-1">
                    <div className="h-1 rounded-full bg-[#ECE5E6] w-full" />
                    <div className="h-1 rounded-full bg-[#ECE5E6] w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 border-t border-[#ECE5E6]">
          <div className="text-center mb-12">
            <h2 className={`${playfair.className} text-2xl sm:text-3xl font-semibold text-[#1d1b1e] tracking-tight`}>How it works</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {STEPS.map((step, i) => (
              <div key={step.title} className="text-center sm:text-left">
                <div className="w-11 h-11 rounded-2xl bg-[#fdd5e1]/60 text-[#9a4153] flex items-center justify-center mb-4 mx-auto sm:mx-0">
                  <span className="material-symbols-outlined text-[22px]">{step.icon}</span>
                </div>
                <h3 className="text-sm font-semibold text-[#1d1b1e] mb-1.5">
                  {i + 1}. {step.title}
                </h3>
                <p className="text-sm text-[#7B7579] leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 border-t border-[#ECE5E6] scroll-mt-16">
          <div className="text-center mb-12">
            <h2 className={`${playfair.className} text-2xl sm:text-3xl font-semibold text-[#1d1b1e] tracking-tight mb-2`}>
              Everything you need to clip
            </h2>
            <p className="text-sm text-[#7B7579]">
              What&apos;s actually in Flovura today — nothing on this page is a &quot;coming soon.&quot;
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="bg-white border border-[#ECE5E6] rounded-2xl p-5 shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)]"
              >
                <div className="w-9 h-9 rounded-xl bg-[#fdd5e1]/60 text-[#9a4153] flex items-center justify-center mb-3">
                  <span className="material-symbols-outlined text-[18px]">{f.icon}</span>
                </div>
                <h3 className="text-sm font-semibold text-[#1d1b1e] mb-1">{f.title}</h3>
                <p className="text-xs text-[#7B7579] leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing preview */}
        <section id="pricing" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 border-t border-[#ECE5E6] scroll-mt-16">
          <div className="text-center mb-3">
            <h2 className={`${playfair.className} text-2xl sm:text-3xl font-semibold text-[#1d1b1e] tracking-tight mb-2`}>
              Pricing that scales with you
            </h2>
            <p className="text-sm text-[#7B7579]">
              Prices in INR. A monthly allowance of source-video minutes, watermark-free — save ~30% billed yearly once you&apos;re signed
              in.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-5xl mx-auto mt-10 items-stretch">
            {TIER_ORDER.map((tier) => {
              const cfg = TIER_CONFIG[tier];
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
                    <span className="text-2xl font-semibold text-[#9a4153]">₹{cfg.priceMonthly.toLocaleString("en-IN")}</span>
                    <span className="text-xs text-[#7B7579]"> / month</span>
                  </div>
                  <p className="text-[11px] text-[#7B7579] mb-3">or ₹{cfg.priceYearlyPerMonth.toLocaleString("en-IN")}/mo billed yearly</p>
                  <p className="text-sm font-semibold text-[#1d1b1e] mb-1">
                    {formatMinutes(creditsToMinutes(cfg.monthlyCredits))}
                    <span className="text-[#7B7579] font-normal text-xs"> of video / month</span>
                  </p>
                  <ul className="space-y-1.5 text-xs text-[#544244] mb-5 mt-4 text-left flex-1">
                    {TIER_FEATURES[tier].map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <span className="material-symbols-outlined text-[14px] text-[#10B981] mt-0.5 shrink-0">check</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/signup"
                    className="mt-auto py-2.5 rounded-full text-xs font-semibold bg-[#ed8395] text-white shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150"
                  >
                    Get Started
                  </Link>
                </div>
              );
            })}
          </div>
          <p className="text-center text-xs text-[#B3ACA6] mt-8">
            Credit packs are also available for one-off use, no subscription required —{" "}
            <Link href="/pricing" className="text-[#9a4153] underline underline-offset-2 hover:text-[#1d1b1e]">
              see full pricing
            </Link>
            .
          </p>
        </section>

        {/* FAQ */}
        <section className="max-w-2xl mx-auto px-4 sm:px-6 py-16 border-t border-[#ECE5E6]">
          <div className="text-center mb-10">
            <h2 className={`${playfair.className} text-2xl sm:text-3xl font-semibold text-[#1d1b1e] tracking-tight`}>
              Frequently asked
            </h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((f) => (
              <FaqItem key={f.q} q={f.q} a={f.a} />
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t border-[#ECE5E6]">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center">
            <h2 className={`${playfair.className} text-2xl sm:text-3xl font-semibold text-[#1d1b1e] tracking-tight mb-3`}>
              Ship your next short today
            </h2>
            <p className="text-sm text-[#7B7579] mb-7">1 free credit, no card required.</p>
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 py-3 px-7 rounded-full bg-[#ed8395] text-white font-semibold text-sm shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150 active:scale-[0.98]"
            >
              <span>Start clipping free</span>
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
