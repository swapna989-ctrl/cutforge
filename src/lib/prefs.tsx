"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Ratio, CaptionStyle, CaptionFont, CaptionPosition, CaptionLanguage, CaptionLineCount, ClipLength } from "@/lib/pipeline";
import { useAuth } from "@/lib/auth";

export type Prefs = {
  defaultRatio: Ratio;
  defaultCaptionStyle: CaptionStyle;
  defaultCaptionFont: CaptionFont;
  defaultCaptionPosition: CaptionPosition;
  defaultCaptionLanguage: CaptionLanguage;
  defaultCaptionLineCount: CaptionLineCount;
  defaultClipLength: ClipLength;
};

const DEFAULT_PREFS: Prefs = {
  defaultRatio: "9:16",
  defaultCaptionStyle: "classic",
  defaultCaptionFont: "geist",
  defaultCaptionPosition: "auto",
  defaultCaptionLanguage: "auto",
  defaultCaptionLineCount: "auto",
  defaultClipLength: "auto",
};

const STORAGE_PREFIX = "flovura_prefs:";
const VALID_RATIOS: Ratio[] = ["9:16", "16:9", "1:1"];
const VALID_CAPTION_STYLES: CaptionStyle[] = ["none", "classic", "bold_yellow", "rose", "glow", "punch", "minimalist", "vlog"];
const VALID_CAPTION_FONTS: CaptionFont[] = [
  "geist",
  "montserrat",
  "poppins",
  "fredoka",
  "pt_serif",
  "roboto",
  "ubuntu",
  "zalando_sans",
  "cormorant_garamond",
];
const VALID_CAPTION_POSITIONS: CaptionPosition[] = ["auto", "top", "middle", "bottom"];
const VALID_CAPTION_LANGUAGES: CaptionLanguage[] = ["auto", "hinglish"];
const VALID_CAPTION_LINE_COUNTS: CaptionLineCount[] = ["auto", "one_line", "two_words", "three_lines"];
const VALID_CLIP_LENGTHS: ClipLength[] = ["auto", "short", "long"];

function sanitize(raw: unknown): Prefs {
  if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
  const r = raw as Partial<Record<keyof Prefs, unknown>>;
  return {
    defaultRatio: typeof r.defaultRatio === "string" && VALID_RATIOS.includes(r.defaultRatio as Ratio) ? (r.defaultRatio as Ratio) : DEFAULT_PREFS.defaultRatio,
    defaultCaptionStyle:
      typeof r.defaultCaptionStyle === "string" && VALID_CAPTION_STYLES.includes(r.defaultCaptionStyle as CaptionStyle)
        ? (r.defaultCaptionStyle as CaptionStyle)
        : DEFAULT_PREFS.defaultCaptionStyle,
    defaultCaptionFont:
      typeof r.defaultCaptionFont === "string" && VALID_CAPTION_FONTS.includes(r.defaultCaptionFont as CaptionFont)
        ? (r.defaultCaptionFont as CaptionFont)
        : DEFAULT_PREFS.defaultCaptionFont,
    defaultCaptionPosition:
      typeof r.defaultCaptionPosition === "string" && VALID_CAPTION_POSITIONS.includes(r.defaultCaptionPosition as CaptionPosition)
        ? (r.defaultCaptionPosition as CaptionPosition)
        : DEFAULT_PREFS.defaultCaptionPosition,
    defaultCaptionLanguage:
      typeof r.defaultCaptionLanguage === "string" && VALID_CAPTION_LANGUAGES.includes(r.defaultCaptionLanguage as CaptionLanguage)
        ? (r.defaultCaptionLanguage as CaptionLanguage)
        : DEFAULT_PREFS.defaultCaptionLanguage,
    defaultCaptionLineCount:
      typeof r.defaultCaptionLineCount === "string" && VALID_CAPTION_LINE_COUNTS.includes(r.defaultCaptionLineCount as CaptionLineCount)
        ? (r.defaultCaptionLineCount as CaptionLineCount)
        : DEFAULT_PREFS.defaultCaptionLineCount,
    defaultClipLength:
      typeof r.defaultClipLength === "string" && VALID_CLIP_LENGTHS.includes(r.defaultClipLength as ClipLength)
        ? (r.defaultClipLength as ClipLength)
        : DEFAULT_PREFS.defaultClipLength,
  };
}

const PrefsContext = createContext<{
  prefs: Prefs;
  ready: boolean;
  updatePrefs: (patch: Partial<Prefs>) => void;
} | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady } = useAuth();
  const [state, setState] = useState<{ prefs: Prefs; ready: boolean; userId: string | null }>({
    prefs: DEFAULT_PREFS,
    ready: false,
    userId: null,
  });

  useEffect(() => {
    // Waits for auth to resolve, then loads (or resets) prefs scoped to that specific user's
    // id — otherwise two different accounts on the same browser would share one set of defaults.
    if (!authReady) return;
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to auth resolving to "signed out", an external system
      setState({ prefs: DEFAULT_PREFS, ready: true, userId: null });
      return;
    }
    let prefs = DEFAULT_PREFS;
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + user.id);
      if (raw) prefs = sanitize(JSON.parse(raw));
    } catch {
      // keep defaults
    }
    setState({ prefs, ready: true, userId: user.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on user.id, not user object identity, so token refreshes don't re-trigger a reload
  }, [authReady, user?.id]);

  function updatePrefs(patch: Partial<Prefs>) {
    setState((prev) => {
      if (!prev.userId) return prev;
      const next = { ...prev.prefs, ...patch };
      window.localStorage.setItem(STORAGE_PREFIX + prev.userId, JSON.stringify(next));
      return { ...prev, prefs: next };
    });
  }

  return <PrefsContext.Provider value={{ prefs: state.prefs, ready: state.ready, updatePrefs }}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}
