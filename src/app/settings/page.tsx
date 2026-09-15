"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import DashboardShell from "@/components/DashboardShell";
import { useRequireAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { useBilling } from "@/lib/billing";
import { TIER_LABEL } from "@/lib/pricing";
import type { Ratio, CaptionStyle, CaptionLanguage } from "@/lib/pipeline";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

// Mirrors worker/src/ffmpeg.ts's CAPTION_PRESETS closely enough for a preview swatch — the
// worker's own values are what actually render, this is just so a user can see roughly what
// they're picking before it's burned into a real video.
const CAPTION_STYLE_OPTIONS: { value: CaptionStyle; label: string; highlight: string | null }[] = [
  { value: "classic", label: "Classic", highlight: null },
  { value: "bold_yellow", label: "Bold Yellow", highlight: "#FFFF00" },
  { value: "rose", label: "Rose", highlight: "#ed8395" },
];

function CaptionPreview({ highlight, bold }: { highlight: string | null; bold: boolean }) {
  const strokeStyle = { WebkitTextStroke: "2px black", paintOrder: "stroke fill" } as const;
  return (
    <div className="rounded-lg bg-[#1a1a1a] px-2 py-3 flex items-center justify-center leading-tight">
      <span className={`text-[11px] text-white uppercase ${bold ? "font-extrabold" : "font-medium"}`} style={strokeStyle}>
        SAMPLE{" "}
        <span style={{ ...strokeStyle, color: highlight ?? "#fff" }}>TEXT</span>
      </span>
    </div>
  );
}

function SectionCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-[#ECE5E6] rounded-3xl p-5 sm:p-6 shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)]">
      <h2 className="text-base font-semibold text-[#1d1b1e] mb-1">{title}</h2>
      <p className="text-xs text-[#7B7579] mb-5">{description}</p>
      {children}
    </section>
  );
}

function SaveButton({ state }: { state: "idle" | "saving" | "saved" }) {
  return (
    <button
      type="submit"
      disabled={state === "saving"}
      className="px-5 py-2.5 rounded-full text-xs font-semibold bg-[#ed8395] text-white shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
    >
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save changes"}
    </button>
  );
}

export default function SettingsPage() {
  const { ready, user, updateProfile } = useRequireAuth();
  const { prefs, updatePrefs } = usePrefs();
  const billing = useBilling();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileState, setProfileState] = useState<"idle" | "saving" | "saved">("idle");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [emailChangePending, setEmailChangePending] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const [ratio, setRatio] = useState<Ratio>(prefs.defaultRatio);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(prefs.defaultCaptionStyle);
  const [captionLanguage, setCaptionLanguage] = useState<CaptionLanguage>(prefs.defaultCaptionLanguage);
  const [exportDefaultsState, setExportDefaultsState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    // Seeds the form once the real Supabase user arrives asynchronously — an external system,
    // so this is the sanctioned "subscribe and sync local state" use of an effect.
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  useEffect(() => {
    // Seeds the form once prefs load (and again whenever they change from elsewhere, e.g. a
    // different tab) — same rationale as the effect above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRatio(prefs.defaultRatio);
    setCaptionStyle(prefs.defaultCaptionStyle);
    setCaptionLanguage(prefs.defaultCaptionLanguage);
  }, [prefs]);

  if (!ready || !user) return null;

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProfileState("saving");
    setProfileError(null);
    setEmailChangePending(false);
    const { error, emailChangePending: pending } = await updateProfile({ name, email });
    if (error) {
      setProfileState("idle");
      setProfileError(error);
      return;
    }
    setProfileState("saved");
    if (pending) setEmailChangePending(true);
    window.setTimeout(() => setProfileState("idle"), 1800);
  }

  async function handleCancelPlan() {
    setPlanError(null);
    const { error } = await billing.cancelPlan();
    if (error) setPlanError(error);
  }

  function handleExportDefaultsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setExportDefaultsState("saving");
    window.setTimeout(() => {
      updatePrefs({ defaultRatio: ratio, defaultCaptionStyle: captionStyle, defaultCaptionLanguage: captionLanguage });
      setExportDefaultsState("saved");
      window.setTimeout(() => setExportDefaultsState("idle"), 1800);
    }, 300);
  }

  return (
    <DashboardShell>
      <div className="mb-8">
        <h1 className={`${playfair.className} text-2xl sm:text-3xl font-semibold text-[#1d1b1e] tracking-tight`}>Settings</h1>
        <p className="text-sm text-[#7B7579] mt-1">Manage your profile, export defaults, and plan.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <SectionCard title="Profile" description="Your name and email, shown across CutForge.">
          <form onSubmit={handleProfileSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#7B7579] mb-1.5">Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#FAF8F7] border border-[#ECE5E6] rounded-xl px-4 py-2.5 text-sm text-[#1d1b1e] focus:border-[#ed8395] focus:ring-2 focus:ring-[#ed8395]/20 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#7B7579] mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#FAF8F7] border border-[#ECE5E6] rounded-xl px-4 py-2.5 text-sm text-[#1d1b1e] focus:border-[#ed8395] focus:ring-2 focus:ring-[#ed8395]/20 outline-none transition-colors"
              />
            </div>
            {profileError && <p className="text-xs text-[#B0503E]">{profileError}</p>}
            {emailChangePending && (
              <p className="text-xs text-[#9a4153]">Check your new email address for a confirmation link to finish the change.</p>
            )}

            <div className="pt-1">
              <SaveButton state={profileState} />
            </div>
          </form>
        </SectionCard>

        <SectionCard
          title="Export defaults"
          description="Applied to every new submission — override any time in the workspace."
        >
          <form onSubmit={handleExportDefaultsSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-[#7B7579] mb-2">Default aspect ratio</label>
              <div className="inline-flex items-center p-1 rounded-full bg-[#FAF8F7] border border-[#ECE5E6]">
                {(["9:16", "16:9"] as Ratio[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRatio(r)}
                    className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                      ratio === r ? "bg-[#ed8395] text-white font-semibold" : "text-[#7B7579] hover:text-[#1d1b1e]"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#7B7579] mb-2">Caption style</label>
              <div className="grid grid-cols-3 gap-2">
                {CAPTION_STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCaptionStyle(opt.value)}
                    className={`rounded-xl border p-1.5 text-left transition-all duration-150 cursor-pointer ${
                      captionStyle === opt.value ? "border-[#ed8395] ring-2 ring-[#ed8395]/25" : "border-[#ECE5E6] hover:border-[#D8D0CE]"
                    }`}
                  >
                    <CaptionPreview highlight={opt.highlight} bold={opt.value !== "classic"} />
                    <span className={`block text-center text-[11px] mt-1.5 ${captionStyle === opt.value ? "text-[#9a4153] font-semibold" : "text-[#7B7579]"}`}>
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[#B3ACA6] mt-2">
                Bold Yellow and Rose highlight each word as it&apos;s spoken, timed to your video&apos;s real audio.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#7B7579] mb-2">Caption language</label>
              <div className="inline-flex items-center p-1 rounded-full bg-[#FAF8F7] border border-[#ECE5E6]">
                <button
                  type="button"
                  onClick={() => setCaptionLanguage("auto")}
                  className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                    captionLanguage === "auto" ? "bg-[#ed8395] text-white font-semibold" : "text-[#7B7579] hover:text-[#1d1b1e]"
                  }`}
                >
                  Auto
                </button>
                <button
                  type="button"
                  onClick={() => setCaptionLanguage("hinglish")}
                  className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                    captionLanguage === "hinglish" ? "bg-[#ed8395] text-white font-semibold" : "text-[#7B7579] hover:text-[#1d1b1e]"
                  }`}
                >
                  Hinglish (beta)
                </button>
              </div>
              <p className="text-[11px] text-[#B3ACA6] mt-2">
                Biases Hindi speech toward Romanized captions (&quot;yeh kya ho raha hai&quot;) instead of Devanagari script. Best-effort —
                quality can vary, especially on longer clips.
              </p>
            </div>

            <div className="pt-1">
              <SaveButton state={exportDefaultsState} />
            </div>
          </form>
        </SectionCard>

        <SectionCard title="Plan & billing" description="Your current CutForge plan and credit balance.">
          <div className="rounded-xl border border-[#ECE5E6] bg-[#FAF8F7] px-4 py-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-[#1d1b1e]">
                {billing.ready ? (billing.hasActivePlan ? `${TIER_LABEL[billing.planTier]} plan` : "Free plan") : "Loading…"}
              </span>
              {billing.hasActivePlan && (
                <span className="px-2 py-0.5 rounded-full bg-[#fdd5e1] text-[#9a4153] text-[10px] font-semibold uppercase tracking-wide">
                  Active
                </span>
              )}
            </div>
            <ul className="space-y-1.5 text-xs text-[#544244]">
              {billing.hasActivePlan && (
                <li className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px] text-[#10B981]">check</span>
                  <span>
                    {billing.planCredits} credit{billing.planCredits === 1 ? "" : "s"} remaining this month
                    {billing.billingCycle === "yearly" ? " (billed yearly)" : ""}
                  </span>
                </li>
              )}
              <li className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px] text-[#10B981]">check</span>
                <span>{billing.freeCredits} free credit{billing.freeCredits === 1 ? "" : "s"} remaining</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px] text-[#10B981]">check</span>
                <span>{billing.paidCredits} paid credit{billing.paidCredits === 1 ? "" : "s"} remaining</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px] text-[#10B981]">check</span>
                <span>{billing.hasActivePlan ? "Watermark-free exports" : "AI clip planning & auto-captions"}</span>
              </li>
            </ul>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/pricing"
              className="flex-1 text-center py-2.5 rounded-full text-xs font-semibold bg-[#ed8395] text-white shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150"
            >
              {billing.hasActivePlan ? "Manage plan" : "Buy credits or subscribe"}
            </Link>
            {billing.hasActivePlan && (
              <button
                onClick={handleCancelPlan}
                className="text-xs text-[#7B7579] hover:text-[#EF4444] underline underline-offset-2 cursor-pointer whitespace-nowrap"
              >
                Cancel plan
              </button>
            )}
          </div>
          {planError && <p className="text-xs text-[#B0503E] mt-2">{planError}</p>}
        </SectionCard>
      </div>
    </DashboardShell>
  );
}
