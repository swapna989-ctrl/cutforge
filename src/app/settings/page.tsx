"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Switch from "@/components/Switch";
import { useRequireAuth } from "@/lib/auth";
import { usePrefs, type ColorGrade } from "@/lib/prefs";
import type { Ratio } from "@/lib/pipeline";

const COLOR_GRADES: ColorGrade[] = ["Cinematic Warm", "Natural", "High Contrast", "Black & White"];

function SectionCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="cf-card bg-[#121216]/90 border border-white/[0.08] rounded-[28px] p-6 sm:p-7 relative overflow-hidden">
      <div className="absolute top-0 left-10 right-10 h-[1px] bg-gradient-to-r from-transparent via-amber-200/25 to-transparent" />
      <h2 className="font-display text-lg font-semibold text-white mb-1">{title}</h2>
      <p className="text-xs text-zinc-400 font-body mb-5">{description}</p>
      {children}
    </section>
  );
}

function SaveButton({ state }: { state: "idle" | "saving" | "saved" }) {
  return (
    <button
      type="submit"
      disabled={state === "saving"}
      className="cf-pill-main px-5 py-2.5 rounded-full text-xs font-bold bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-[#241a03] shadow-cf-pill hover:brightness-110 hover:shadow-cf-pill-lg transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
    >
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved ✓" : "Save changes"}
    </button>
  );
}

export default function SettingsPage() {
  const { ready, user, logout, updateProfile } = useRequireAuth();
  const { prefs, updatePrefs } = usePrefs();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileState, setProfileState] = useState<"idle" | "saving" | "saved">("idle");

  const [ratio, setRatio] = useState<Ratio>(prefs.defaultRatio);
  const [colorGrade, setColorGrade] = useState<ColorGrade>(prefs.colorGrade);
  const [autoCaptions, setAutoCaptions] = useState(prefs.autoCaptions);
  const [beatSync, setBeatSync] = useState(prefs.beatSync);
  const [prefsState, setPrefsState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    // Seeds the form once the async-loaded auth user arrives (see src/lib/auth.tsx).
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  useEffect(() => {
    // Seeds the form once the async-loaded prefs arrive (see src/lib/prefs.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRatio(prefs.defaultRatio);
    setColorGrade(prefs.colorGrade);
    setAutoCaptions(prefs.autoCaptions);
    setBeatSync(prefs.beatSync);
  }, [prefs]);

  if (!ready || !user) return null;

  function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProfileState("saving");
    window.setTimeout(() => {
      updateProfile({ name, email });
      setProfileState("saved");
      window.setTimeout(() => setProfileState("idle"), 1800);
    }, 500);
  }

  function handlePrefsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPrefsState("saving");
    window.setTimeout(() => {
      updatePrefs({ defaultRatio: ratio, colorGrade, autoCaptions, beatSync });
      setPrefsState("saved");
      window.setTimeout(() => setPrefsState("idle"), 1800);
    }, 500);
  }

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <AppShell>
      <div className="mb-10">
        <p className="text-xs font-mono tracking-widest text-amber-300/80 uppercase mb-2">Studio Access</p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="text-sm text-zinc-400 font-body mt-1">Manage your profile, editing defaults, and plan.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <SectionCard title="Profile" description="Your name and email, shown across CutForge Studio.">
          <form onSubmit={handleProfileSubmit} className="space-y-3">
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wide text-zinc-500 mb-1.5">Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#0b0b0e] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:border-amber-300/40 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wide text-zinc-500 mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#0b0b0e] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:border-amber-300/40 outline-none transition-colors"
              />
            </div>
            <div className="pt-1">
              <SaveButton state={profileState} />
            </div>
          </form>
        </SectionCard>

        <SectionCard title="Account" description="Session and sign-out.">
          <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-[#0b0b0e] px-4 py-3">
            <div>
              <p className="text-sm text-white font-medium">{user.name}</p>
              <p className="text-xs text-zinc-500 font-mono">{user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center space-x-1.5 text-[11px] font-medium px-3.5 py-1.5 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 transition-all text-zinc-300 select-none cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">logout</span>
              <span className="tracking-wider uppercase">Log out</span>
            </button>
          </div>
        </SectionCard>

        <SectionCard
          title="Export defaults"
          description="Applied automatically whenever you start a new project — override per-project any time in the workspace."
        >
          <form onSubmit={handlePrefsSubmit} className="space-y-5">
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wide text-zinc-500 mb-2">Default aspect ratio</label>
              <div className="inline-flex items-center p-1 rounded-full bg-[#141418] border border-white/10">
                {(["9:16", "16:9"] as Ratio[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRatio(r)}
                    className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                      ratio === r ? "bg-[#fbf6ee] text-[#08080a] font-semibold" : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wide text-zinc-500 mb-2">Color grade</label>
              <select
                value={colorGrade}
                onChange={(e) => setColorGrade(e.target.value as ColorGrade)}
                className="w-full bg-[#0b0b0e] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:border-amber-300/40 outline-none transition-colors cursor-pointer"
              >
                {COLOR_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1 border-t border-white/[0.06] pt-4">
              <Switch checked={autoCaptions} onChange={setAutoCaptions} label="Auto-generate captions" />
              <Switch checked={beatSync} onChange={setBeatSync} label="Sync cuts to beat" />
            </div>

            <div className="pt-1">
              <SaveButton state={prefsState} />
            </div>
          </form>
        </SectionCard>

        <SectionCard title="Plan" description="Your current CutForge Studio plan.">
          <div className="rounded-xl border border-amber-300/20 bg-amber-400/[0.04] px-4 py-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="font-display text-base font-semibold text-white">Free Plan</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/20 text-amber-200 font-mono text-[9px] tracking-widest font-semibold uppercase">
                Active
              </span>
            </div>
            <ul className="space-y-1.5 text-xs text-zinc-400 font-body">
              <li className="flex items-center space-x-2">
                <span className="material-symbols-outlined text-[14px] text-emerald-400">check</span>
                <span>Unlimited draft projects</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="material-symbols-outlined text-[14px] text-emerald-400">check</span>
                <span>720p preview exports</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="material-symbols-outlined text-[14px] text-emerald-400">check</span>
                <span>Autonomous cut &amp; beat-sync engine</span>
              </li>
            </ul>
          </div>
          <button
            disabled
            className="w-full py-2.5 rounded-full text-xs font-semibold border border-white/10 bg-white/[0.03] text-zinc-500 cursor-not-allowed"
          >
            Upgrade to Studio Pro — Coming soon
          </button>
        </SectionCard>
      </div>
    </AppShell>
  );
}
