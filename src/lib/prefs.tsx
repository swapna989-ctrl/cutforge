"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Ratio } from "@/lib/pipeline";

export type ColorGrade = "Cinematic Warm" | "Natural" | "High Contrast" | "Black & White";

export type Prefs = {
  defaultRatio: Ratio;
  colorGrade: ColorGrade;
  autoCaptions: boolean;
  beatSync: boolean;
};

const DEFAULT_PREFS: Prefs = {
  defaultRatio: "9:16",
  colorGrade: "Cinematic Warm",
  autoCaptions: true,
  beatSync: true,
};

const STORAGE_KEY = "cutforge_prefs";

const PrefsContext = createContext<{
  prefs: Prefs;
  ready: boolean;
  updatePrefs: (patch: Partial<Prefs>) => void;
} | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ prefs: Prefs; ready: boolean }>({ prefs: DEFAULT_PREFS, ready: false });

  useEffect(() => {
    // Deferred to an effect (not a lazy useState initializer) so the first client render
    // matches the server-rendered markup before we read browser-only localStorage.
    let prefs = DEFAULT_PREFS;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) prefs = { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
    } catch {
      // keep defaults
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see src/lib/auth.tsx for rationale
    setState({ prefs, ready: true });
  }, []);

  function updatePrefs(patch: Partial<Prefs>) {
    setState((prev) => {
      const next = { ...prev.prefs, ...patch };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { prefs: next, ready: true };
    });
  }

  return <PrefsContext.Provider value={{ prefs: state.prefs, ready: state.ready, updatePrefs }}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}
