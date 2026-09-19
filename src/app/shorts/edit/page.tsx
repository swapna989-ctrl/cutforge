"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import CropTool from "@/components/CropTool";
import { useRequireAuth } from "@/lib/auth";
import { useBilling } from "@/lib/billing";
import { getMoreCreditsHint } from "@/lib/pricing";
import { getShort, getProject, updateShort, type Short, type Project } from "@/lib/projects";
import type { Ratio, CaptionStyle, CaptionFont, CaptionPosition, CaptionLanguage, CaptionLineCount } from "@/lib/pipeline";
import { CAPTION_STYLE_OPTIONS, CAPTION_FONT_OPTIONS, CAPTION_POSITION_OPTIONS, CAPTION_LINE_COUNT_OPTIONS, CaptionPreview } from "@/lib/captionOptions";

// Must match worker/src/supabase.ts's PREVIEW_FRAME_PENDING exactly — the two can't share a literal
// constant across the frontend/worker package boundary, so it's just kept in sync by hand.
const PREVIEW_FRAME_PENDING = "__pending__";
const RATIO_OPTIONS: Ratio[] = ["9:16", "16:9", "1:1"];

function resolve<T>(shortValue: T | null, projectValue: T): T {
  return shortValue ?? projectValue;
}

function EditShortPageInner() {
  const { ready, user } = useRequireAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shortId = searchParams.get("shortId");
  const projectId = searchParams.get("projectId");
  const billing = useBilling();

  const [short, setShort] = useState<Short | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [section, setSection] = useState<"settings" | "crop">(searchParams.get("section") === "crop" ? "crop" : "settings");

  const [optionCaptionStyle, setOptionCaptionStyle] = useState<CaptionStyle>("classic");
  const [optionCaptionFont, setOptionCaptionFont] = useState<CaptionFont>("geist");
  const [optionCaptionPosition, setOptionCaptionPosition] = useState<CaptionPosition>("auto");
  const [optionCaptionLanguage, setOptionCaptionLanguage] = useState<CaptionLanguage>("auto");
  const [optionCaptionLineCount, setOptionCaptionLineCount] = useState<CaptionLineCount>("auto");
  const [optionRatio, setOptionRatio] = useState<Ratio>("9:16");
  const [cropX, setCropX] = useState<number | null>(null);
  const [cropY, setCropY] = useState<number | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "requesting" | "ready" | "failed">("idle");

  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Loads the short + its parent project once, seeding every option from short.<field> ??
  // project.<field> — the same resolve() a regenerate actually applies on the worker side.
  useEffect(() => {
    if (!ready || !user || !shortId || !projectId) return;
    let cancelled = false;
    Promise.all([getShort(shortId), getProject(projectId)])
      .then(([s, p]) => {
        if (cancelled) return;
        if (!s || !p) {
          setLoadError("This clip couldn't be found.");
          setLoadState("error");
          return;
        }
        setShort(s);
        setProject(p);
        setOptionCaptionStyle(resolve(s.captionStyle, p.captionStyle));
        setOptionCaptionFont(resolve(s.captionFont, p.captionFont));
        setOptionCaptionPosition(resolve(s.captionPosition, p.captionPosition));
        setOptionCaptionLanguage(resolve(s.captionLanguage, p.captionLanguage));
        setOptionCaptionLineCount(resolve(s.captionLineCount, p.captionLineCount));
        setOptionRatio(resolve(s.ratio, p.ratio));
        setCropX(s.cropX);
        setCropY(s.cropY);
        setLoadState("loaded");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load this clip.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [ready, user, shortId, projectId]);

  // Ensures a preview frame exists once the Reframe section is opened — requests one (the
  // '__pending__' sentinel the worker's claimNextPreviewFrame polls for) if none exists yet, then
  // polls until the worker fills it in, matching this app's existing interval-poll pattern.
  useEffect(() => {
    if (section !== "crop" || !short) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function checkOnce(): Promise<boolean> {
      const fresh = await getShort(short!.id).catch(() => null);
      if (cancelled || !fresh) return false;

      if (fresh.previewFrameKey && fresh.previewFrameKey !== PREVIEW_FRAME_PENDING) {
        const res = await fetch(`/api/download-url?projectId=${short!.projectId}&shortId=${short!.id}&kind=preview`);
        if (cancelled) return true;
        if (res.ok) {
          const body = (await res.json()) as { downloadUrl: string };
          setPreviewUrl(body.downloadUrl);
          setPreviewState("ready");
        } else {
          setPreviewState("failed");
        }
        return true;
      }

      if (fresh.previewFrameKey === PREVIEW_FRAME_PENDING) {
        setPreviewState("requesting");
        return false;
      }

      // Never requested yet — request it once, then keep polling.
      setPreviewState("requesting");
      await updateShort(short!.id, { previewFrameKey: PREVIEW_FRAME_PENDING }).catch(() => {});
      return false;
    }

    checkOnce().then((done) => {
      if (cancelled || done) return;
      interval = setInterval(async () => {
        const isDone = await checkOnce();
        if (isDone && interval) clearInterval(interval);
      }, 3000);
    });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on section/short.id, not the whole short object, which would re-trigger this on every unrelated field change
  }, [section, short?.id]);

  async function handleRegenerate() {
    if (!short || regenerating) return;
    setRegenerating(true);
    setRegenerateError(null);
    try {
      // Every option field is written explicitly on every regenerate, even one left unchanged —
      // simpler than tracking which fields the user actually touched, and with no observable
      // downside today since nothing else in the app ever changes a project's own defaults after
      // creation for a "true null-inherit" to meaningfully cascade from.
      await updateShort(short.id, {
        captionStyle: optionCaptionStyle,
        captionFont: optionCaptionFont,
        captionPosition: optionCaptionPosition,
        captionLanguage: optionCaptionLanguage,
        captionLineCount: optionCaptionLineCount,
        ratio: optionRatio,
        cropX,
        cropY,
        status: "regenerating",
      });

      // Poll until the worker's claim + regenerate finishes (or fails, per regenerate.ts's own
      // "revert to ready, never 'failed'" design — 'failed' is only possible here for a short
      // that was already hard-failed before its very first edit).
      await new Promise<void>((resolveWait) => {
        const interval = setInterval(async () => {
          const fresh = await getShort(short.id).catch(() => null);
          if (cancelledRef.current) {
            clearInterval(interval);
            resolveWait();
            return;
          }
          if (fresh && fresh.status !== "regenerating" && fresh.status !== "processing") {
            clearInterval(interval);
            resolveWait();
          }
        }, 3000);
      });

      if (!cancelledRef.current) router.push(`/workspace?load=${short.projectId}`);
    } catch (err) {
      if (!cancelledRef.current) {
        setRegenerateError(err instanceof Error ? err.message : "Could not start regenerating this clip");
        setRegenerating(false);
      }
    }
  }

  if (!ready || !user) return null;

  if (loadState === "loading") {
    return (
      <DashboardShell>
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 rounded-full border-2 border-[#ECE5E6] border-t-[#ed8395] animate-spin" />
        </div>
      </DashboardShell>
    );
  }

  if (loadState === "error" || !short || !project) {
    return (
      <DashboardShell>
        <div className="max-w-md mx-auto text-center py-24">
          <p className="text-sm text-[#B0503E] mb-4">{loadError ?? "This clip couldn't be found."}</p>
          <button onClick={() => router.back()} className="text-sm font-medium text-[#9a4153] underline underline-offset-2 cursor-pointer">
            Go back
          </button>
        </div>
      </DashboardShell>
    );
  }

  const alreadyInFlight = short.status === "regenerating" || short.status === "processing";
  const canAfford = billing.ready && billing.availableCredits >= 1;

  return (
    <DashboardShell>
      <div className="max-w-lg mx-auto pt-2 pb-16">
        <div className="flex items-center justify-between gap-3 mb-5">
          <h1 className="text-xl font-semibold text-[#1d1b1e] leading-snug truncate">{short.hook}</h1>
          <button
            onClick={() => router.push(`/workspace?load=${short.projectId}`)}
            aria-label="Close"
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[#7B7579] hover:bg-[#FAF8F7] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {alreadyInFlight ? (
          <div className="bg-white rounded-2xl p-6 border border-[#ECE5E6] text-center space-y-3">
            <div className="w-6 h-6 mx-auto rounded-full border-2 border-[#ECE5E6] border-t-[#ed8395] animate-spin" />
            <p className="text-sm text-[#544244]">This clip is already regenerating — hang tight.</p>
          </div>
        ) : (
          <>
            <div className="inline-flex items-center p-1 rounded-full bg-[#FAF8F7] border border-[#ECE5E6] mb-5">
              <button
                type="button"
                onClick={() => setSection("settings")}
                className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                  section === "settings" ? "bg-[#ed8395] text-white font-semibold" : "text-[#7B7579] hover:text-[#1d1b1e]"
                }`}
              >
                Settings
              </button>
              <button
                type="button"
                onClick={() => setSection("crop")}
                className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                  section === "crop" ? "bg-[#ed8395] text-white font-semibold" : "text-[#7B7579] hover:text-[#1d1b1e]"
                }`}
              >
                Reframe
              </button>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-[#ECE5E6] shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] space-y-5">
              {section === "settings" ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-[#7B7579] mb-2">Caption style</label>
                    <div className="grid grid-cols-3 gap-2">
                      {CAPTION_STYLE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setOptionCaptionStyle(opt.value)}
                          className={`rounded-xl border p-1.5 text-left transition-all duration-150 cursor-pointer ${
                            optionCaptionStyle === opt.value ? "border-[#ed8395] ring-2 ring-[#ed8395]/25" : "border-[#ECE5E6] hover:border-[#D8D0CE]"
                          }`}
                        >
                          <CaptionPreview
                            highlight={opt.highlight}
                            bold={opt.bold}
                            italic={opt.italic}
                            uppercase={opt.uppercase}
                            textColor={opt.textColor}
                            glow={opt.glow}
                            noCaptions={opt.noCaptions}
                          />
                          <span
                            className={`block text-center text-[11px] mt-1.5 ${
                              optionCaptionStyle === opt.value ? "text-[#9a4153] font-semibold" : "text-[#7B7579]"
                            }`}
                          >
                            {opt.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#7B7579] mb-2">Font</label>
                    <div className="grid grid-cols-3 gap-2">
                      {CAPTION_FONT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setOptionCaptionFont(opt.value)}
                          className={`rounded-xl border px-2 py-2.5 text-center transition-all duration-150 cursor-pointer ${
                            optionCaptionFont === opt.value ? "border-[#ed8395] ring-2 ring-[#ed8395]/25" : "border-[#ECE5E6] hover:border-[#D8D0CE]"
                          }`}
                        >
                          <span
                            className={`block text-xs truncate ${opt.className} ${optionCaptionFont === opt.value ? "text-[#9a4153]" : "text-[#1d1b1e]"}`}
                          >
                            {opt.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#7B7579] mb-2">Position</label>
                    <div className="inline-flex items-center p-1 rounded-full bg-[#FAF8F7] border border-[#ECE5E6]">
                      {CAPTION_POSITION_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setOptionCaptionPosition(opt.value)}
                          className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                            optionCaptionPosition === opt.value ? "bg-[#ed8395] text-white font-semibold" : "text-[#7B7579] hover:text-[#1d1b1e]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#7B7579] mb-2">Line count</label>
                    <div className="inline-flex flex-wrap items-center p-1 rounded-full bg-[#FAF8F7] border border-[#ECE5E6]">
                      {CAPTION_LINE_COUNT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setOptionCaptionLineCount(opt.value)}
                          className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                            optionCaptionLineCount === opt.value ? "bg-[#ed8395] text-white font-semibold" : "text-[#7B7579] hover:text-[#1d1b1e]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#7B7579] mb-2">Caption language</label>
                    <div className="inline-flex items-center p-1 rounded-full bg-[#FAF8F7] border border-[#ECE5E6]">
                      <button
                        type="button"
                        onClick={() => setOptionCaptionLanguage("auto")}
                        className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                          optionCaptionLanguage === "auto" ? "bg-[#ed8395] text-white font-semibold" : "text-[#7B7579] hover:text-[#1d1b1e]"
                        }`}
                      >
                        Auto
                      </button>
                      <button
                        type="button"
                        onClick={() => setOptionCaptionLanguage("hinglish")}
                        className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                          optionCaptionLanguage === "hinglish" ? "bg-[#ed8395] text-white font-semibold" : "text-[#7B7579] hover:text-[#1d1b1e]"
                        }`}
                      >
                        Hinglish (beta)
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-[#7B7579] mb-2">Aspect ratio</label>
                    <div className="inline-flex items-center p-1 rounded-full bg-[#FAF8F7] border border-[#ECE5E6]">
                      {RATIO_OPTIONS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setOptionRatio(r)}
                          className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                            optionRatio === r ? "bg-[#ed8395] text-white font-semibold" : "text-[#7B7579] hover:text-[#1d1b1e]"
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#7B7579] mb-2">Crop</label>
                    {previewState === "ready" && previewUrl ? (
                      <CropTool
                        imageUrl={previewUrl}
                        ratio={optionRatio}
                        initialX={cropX}
                        initialY={cropY}
                        onChange={(x, y) => {
                          setCropX(x);
                          setCropY(y);
                        }}
                      />
                    ) : previewState === "failed" ? (
                      <p className="text-xs text-[#B0503E]">
                        Couldn&apos;t load a preview to crop from — this project may predate editing support.
                      </p>
                    ) : (
                      <div className="flex items-center justify-center gap-2 py-10 bg-[#FAF8F7] rounded-xl">
                        <div className="w-4 h-4 rounded-full border-2 border-[#ECE5E6] border-t-[#ed8395] animate-spin" />
                        <span className="text-xs text-[#7B7579]">Preparing a preview frame…</span>
                      </div>
                    )}
                  </div>
                </>
              )}

              {regenerateError && <p className="text-xs text-[#B0503E]">{regenerateError}</p>}
              {!canAfford && <p className="text-xs text-[#B0503E]">You&apos;re out of credits — {getMoreCreditsHint(billing.planTier)} to keep editing.</p>}

              <button
                type="button"
                onClick={handleRegenerate}
                disabled={regenerating || !canAfford}
                className="w-full py-3.5 px-6 rounded-full bg-[#ed8395] text-white font-semibold text-sm shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">autorenew</span>
                {regenerating ? "Regenerating…" : "Regenerate Clip (Costs 1 Credit)"}
              </button>
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}

export default function EditShortPage() {
  return (
    <Suspense fallback={null}>
      <EditShortPageInner />
    </Suspense>
  );
}
