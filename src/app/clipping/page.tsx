"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import DashboardShell from "@/components/DashboardShell";
import ProjectCard from "@/components/ProjectCard";
import { useRequireAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { useBilling } from "@/lib/billing";
import { creditsForDuration } from "@/lib/pricing";
import { readVideoDuration, uploadClipToR2, validateVideoFileBasics, validateVideoDuration } from "@/lib/upload";
import { listProjects, createProject, createProjectClip, updateProject, deleteProject, type Project } from "@/lib/projects";
import type { Ratio, CaptionStyle, CaptionLanguage } from "@/lib/pipeline";

// A project sits in one of these while the worker is actively on it — used to decide whether
// this page's own poll loop needs to keep running.
const IN_PROGRESS_STATUSES = ["ingesting", "queued", "synthesizing"];

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

// The real signup grant every new account gets (supabase/migrations/0002_billing.sql) — the
// only fixed "total" that actually exists for credits. Paid packs (10/30/100) have no fixed
// total to compare against, so "X of Y" only means something for the free-tier count.
const FREE_CREDITS_GRANT = 5;

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

export default function ClippingPage() {
  const { ready, user } = useRequireAuth();
  const { prefs, ready: prefsReady, updatePrefs } = usePrefs();
  const billing = useBilling();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The "configure, then generate" step — appears once a link's been submitted or a file's been
  // picked, before either actually gets queued for the worker. `pending` is null when this panel
  // isn't showing at all (the plain input bar, today's only state). For files, uploading starts
  // immediately in the background (no reason to make someone wait idle to see the panel) and
  // `projectId`/`creditsEstimate` fill in once that finishes; for URLs there's nothing to upload,
  // so the panel is ready to generate from the moment it opens.
  const [pending, setPending] = useState<{
    kind: "file" | "url";
    label: string;
    projectId: string | null;
    creditsEstimate: number | null;
    uploadDone: boolean;
  } | null>(null);
  const [optionRatio, setOptionRatio] = useState<Ratio>("9:16");
  const [optionCaptionStyle, setOptionCaptionStyle] = useState<CaptionStyle>("classic");
  const [optionCaptionLanguage, setOptionCaptionLanguage] = useState<CaptionLanguage>("auto");
  // Required before Generate is enabled — this product downloads and reprocesses someone else's
  // YouTube/Twitch video or a file the user picked, so an explicit rights attestation is real
  // legal protection, not just a UI flourish. Reset on every new pending submission rather than
  // persisted, so it can never carry over and silently apply to a video it was never shown for.
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    listProjects()
      .then((data) => {
        if (cancelled) return;
        setProjects(data);
        setLoadState("loaded");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load projects.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  function handleDeleted(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }

  // Keeps every card's real status/progress live while anything is still processing — the same
  // "what's actually true right now" polling WorkspaceView already does for a single project,
  // just applied to the whole list so users can watch clips generate without leaving this page.
  // Depends on the derived boolean (not `projects` itself) so a poll tick that keeps the same
  // in-progress set doesn't tear down and rebuild the interval every 3 seconds.
  const hasInProgress = projects.some((p) => IN_PROGRESS_STATUSES.includes(p.pipelineStatus));
  useEffect(() => {
    if (loadState !== "loaded" || !hasInProgress) return;

    const interval = setInterval(async () => {
      try {
        const fresh = await listProjects();
        setProjects(fresh);
        // The worker charges credits itself now, once it knows a submission's real duration (see
        // charge_project_credits) — nothing on this page triggers that RPC directly anymore, so
        // this is what keeps the visible balance from going stale while that charge happens
        // somewhere in the background.
        billing.refresh();
      } catch {
        // Transient — the next tick tries again rather than surfacing a poll-loop error.
      }
    }, 3000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- billing is a fresh object every render; only loadState/hasInProgress should restart this interval
  }, [loadState, hasInProgress]);

  /** Uploads every picked file for real (same R2 + project/project_clips flow WorkspaceView
   *  uses), then hands off to the workspace's own review screen — landing there only once
   *  there's something real to review, not as an empty intermediate page. Format/size/duration
   *  are validated up front, before any upload starts, so a bad file never wastes bandwidth or
   *  leaves a half-created project behind. */
  async function handleFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setFileUploadError(null);

    for (const file of files) {
      const basicsError = validateVideoFileBasics(file);
      if (basicsError) {
        setFileUploadError(basicsError);
        return;
      }
    }

    setUploadingFiles(true);

    // Duration needs the file's real metadata, so it's checked as its own pass (after the cheap
    // format/size checks, before any upload starts) rather than inline in the upload loop below.
    const durations: (number | null)[] = [];
    for (const file of files) {
      durations.push(await readVideoDuration(file));
    }
    for (let i = 0; i < files.length; i++) {
      const durationError = validateVideoDuration(files[i], durations[i]);
      if (durationError) {
        setFileUploadError(durationError);
        setUploadingFiles(false);
        return;
      }
    }

    if (!billing.ready || !billing.canExport) {
      setFileUploadError("You're out of credits — buy more or subscribe to keep clipping.");
      setUploadingFiles(false);
      return;
    }

    // The real charge happens server-side once the worker measures the source's actual duration
    // (see charge_project_credits) — but every duration is already known here, so a submission
    // that obviously can't be afforded is rejected before wasting any upload bandwidth on it,
    // rather than uploading first and only finding out it fails once queued.
    let creditsNeeded: number | null = null;
    if (durations.every((d) => d != null)) {
      const totalSeconds = durations.reduce((sum, d) => sum + (d ?? 0), 0);
      creditsNeeded = creditsForDuration(totalSeconds);
      if (creditsNeeded > billing.availableCredits) {
        setFileUploadError(
          `This video needs ${creditsNeeded} credits (you have ${billing.availableCredits}) — buy more or upgrade your plan.`
        );
        setUploadingFiles(false);
        return;
      }
    }

    // Opens the configure step right away, seeded from the remembered defaults — upload happens
    // in the background below while the user looks at (and can already adjust) their options,
    // rather than staring at a bare spinner with nothing to do until it finishes.
    setOptionRatio(prefsReady ? prefs.defaultRatio : "9:16");
    setOptionCaptionStyle(prefsReady ? prefs.defaultCaptionStyle : "classic");
    setOptionCaptionLanguage(prefsReady ? prefs.defaultCaptionLanguage : "auto");
    setGenerateError(null);
    setRightsConfirmed(false);
    setPending({
      kind: "file",
      label: files.length === 1 ? files[0].name : `${files.length} files`,
      projectId: null,
      creditsEstimate: creditsNeeded,
      uploadDone: false,
    });

    let createdProjectId: string | null = null;

    try {
      const firstKey = await uploadClipToR2(files[0]);

      // Starts as "ingesting" and STAYS there — unlike before, this is no longer flipped to
      // "queued" automatically. That only happens once the user actually clicks "Generate" on
      // the configure panel above, with whatever ratio/caption choices they landed on.
      const created = await createProject({
        name: files[0].name,
        ratio: prefsReady ? prefs.defaultRatio : "9:16",
        captionStyle: prefsReady ? prefs.defaultCaptionStyle : "classic",
        captionLanguage: prefsReady ? prefs.defaultCaptionLanguage : "auto",
        pipelineStatus: "ingesting",
        progress: 0,
        sourceKey: firstKey,
        // Placeholder — the worker decides the real value once it charges for this project's
        // actual duration (see charge_project_credits), which is also the moment it's certain
        // whether that charge came from a paid source or a free one.
        watermark: true,
      });
      createdProjectId = created.id;

      await createProjectClip({ projectId: created.id, position: 0, sourceKey: firstKey, fileName: files[0].name, duration: durations[0] });

      for (let i = 1; i < files.length; i++) {
        const key = await uploadClipToR2(files[i]);
        await createProjectClip({ projectId: created.id, position: i, sourceKey: key, fileName: files[i].name, duration: durations[i] });
      }

      // Shows up in the list immediately as "ingesting" — same real-time feedback as before —
      // while the configure panel stays open above it until Generate is clicked.
      setProjects((prev) => [{ ...created, status: "draft" }, ...prev]);
      setPending((prev) => (prev ? { ...prev, projectId: created.id, uploadDone: true } : prev));
      setUploadingFiles(false);
    } catch (err) {
      if (createdProjectId) deleteProject(createdProjectId).catch(() => {});
      setFileUploadError(err instanceof Error ? err.message : "Upload failed");
      setUploadingFiles(false);
      setPending(null);
    }
  }

  // The combined bar's one action: a pasted link starts a real link-ingestion project (the
  // worker downloads it — see worker/src/ytdlp.ts). Getting clips with neither a link typed nor
  // a file already picked (that flow is separate — see the upload icon's own onClick) is a
  // validation error, not an implicit fallback into a different flow.
  // Opens the same configure step the file path uses, rather than queuing immediately — nothing
  // is created yet, since there's no upload in flight to show progress for while the user looks
  // at their options; Generate is what actually calls createProject now (see handleGenerate).
  function handleUrlSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setUrlError("No YouTube/Twitch link or file selected — paste a link or choose a file to upload.");
      return;
    }
    setUrlError(null);

    if (!billing.ready || !billing.canExport) {
      setUrlError("You're out of credits — buy more or subscribe to keep clipping.");
      return;
    }

    setOptionRatio(prefsReady ? prefs.defaultRatio : "9:16");
    setOptionCaptionStyle(prefsReady ? prefs.defaultCaptionStyle : "classic");
    setOptionCaptionLanguage(prefsReady ? prefs.defaultCaptionLanguage : "auto");
    setGenerateError(null);
    setRightsConfirmed(false);
    setPending({ kind: "url", label: trimmed, projectId: null, creditsEstimate: null, uploadDone: true });
  }

  /** The actual hand-off to the worker, for either kind of pending submission — deliberately the
   *  only place either "queue a file project" or "create a URL project" happens now, so both
   *  paths only ever fire once the user has seen and confirmed their real options. Also persists
   *  whatever was picked as the new default (see usePrefs) — so next time already starts there. */
  async function handleGenerate() {
    if (!pending) return;
    setGenerating(true);
    setGenerateError(null);
    updatePrefs({ defaultRatio: optionRatio, defaultCaptionStyle: optionCaptionStyle, defaultCaptionLanguage: optionCaptionLanguage });

    try {
      if (pending.kind === "file") {
        if (!pending.projectId) return; // Generate is disabled until this is set — guards a stray call.
        await updateProject(pending.projectId, {
          ratio: optionRatio,
          captionStyle: optionCaptionStyle,
          captionLanguage: optionCaptionLanguage,
          pipelineStatus: "queued",
        });
        setProjects((prev) =>
          prev.map((p) =>
            p.id === pending.projectId
              ? { ...p, ratio: optionRatio, captionStyle: optionCaptionStyle, captionLanguage: optionCaptionLanguage, pipelineStatus: "queued" }
              : p
          )
        );
      } else {
        const created = await createProject({
          name: pending.label,
          ratio: optionRatio,
          captionStyle: optionCaptionStyle,
          captionLanguage: optionCaptionLanguage,
          pipelineStatus: "queued",
          progress: 0,
          sourceUrl: pending.label,
          // Placeholder — see the matching note in handleFilesPicked.
          watermark: true,
        });
        setProjects((prev) => [created, ...prev]);
        setUrlInput("");
      }
      setPending(null);
      setGenerating(false);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Could not start this project");
      setGenerating(false);
    }
  }

  /** Backs out of the configure step without generating anything — for a file submission this
   *  also deletes the ingesting draft (cascades its project_clips), same rollback path already
   *  used for a real upload failure, so an abandoned draft doesn't linger as a phantom project. */
  function handleCancelPending() {
    if (pending?.kind === "file" && pending.projectId) {
      deleteProject(pending.projectId).catch(() => {});
      setProjects((prev) => prev.filter((p) => p.id !== pending.projectId));
    }
    setPending(null);
    setGenerateError(null);
  }

  if (!ready || !user) return null;

  return (
    <DashboardShell>
      <section className="pt-2 space-y-2 mb-6">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#fdd5e1]/60 text-[#9a4153] text-[11px] font-semibold tracking-wide">
          <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
          <span>Your workspace</span>
        </div>
        <h1 className={`${playfair.className} text-3xl sm:text-4xl font-semibold text-[#1d1b1e] tracking-tight`}>
          The <span className="italic text-[#9a4153]">Clipping</span> Agent
        </h1>
        <p className="text-sm text-[#7B7579] leading-relaxed max-w-md">
          Paste a link or upload your footage — Flovura finds the best moments and turns them into ready-to-post
          shorts.
        </p>
      </section>

      {pending ? (
        /* The configure step — replaces the input bar once a link's been submitted or a file
           picked, so ratio/caption choices are made right here, right before generating, instead
           of being invisible defaults from a settings page no one would think to check first. */
        <section className="mb-8">
          <div className="bg-white rounded-2xl p-5 border border-[#ECE5E6] shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#7B7579] mb-0.5">
                  {pending.kind === "file" ? (pending.uploadDone ? "Uploaded" : "Uploading") : "Ready to clip"}
                </p>
                <p className="text-sm font-semibold text-[#1d1b1e] truncate">{pending.label}</p>
              </div>
              <button
                type="button"
                onClick={handleCancelPending}
                aria-label="Cancel"
                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#7B7579] hover:bg-[#FAF8F7] transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <label className="flex items-start gap-2.5 rounded-xl border border-[#F0B84B]/40 bg-[#FDF6E8] px-3.5 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={rightsConfirmed}
                onChange={(e) => setRightsConfirmed(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-[#D8D0CE] text-[#ed8395] focus:ring-[#ed8395]/40 cursor-pointer shrink-0"
              />
              <span className="text-xs text-[#7B5E2E] leading-snug">
                I confirm I have the rights to use this video and won&apos;t hold Flovura responsible for how it&apos;s used.
              </span>
            </label>

            <div>
              <label className="block text-xs font-medium text-[#7B7579] mb-2">Aspect ratio</label>
              <div className="inline-flex items-center p-1 rounded-full bg-[#FAF8F7] border border-[#ECE5E6]">
                {(["9:16", "16:9", "1:1"] as Ratio[]).map((r) => (
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
                    <CaptionPreview highlight={opt.highlight} bold={opt.value !== "classic"} />
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
              <p className="text-[11px] text-[#B3ACA6] mt-2">
                Biases Hindi speech toward Romanized captions (&quot;yeh kya ho raha hai&quot;) instead of Devanagari script. Best-effort —
                quality can vary, especially on longer clips.
              </p>
            </div>

            <div className="rounded-xl border border-[#ECE5E6] bg-[#FAF8F7] px-4 py-3">
              {pending.kind === "file" ? (
                pending.creditsEstimate != null ? (
                  <p className="text-xs text-[#544244]">
                    <span className="font-semibold text-[#1d1b1e]">
                      ≈ {pending.creditsEstimate} credit{pending.creditsEstimate === 1 ? "" : "s"}
                    </span>{" "}
                    for this video{!pending.uploadDone && <span className="text-[#7B7579]"> · uploading…</span>}
                  </p>
                ) : (
                  <p className="text-xs text-[#7B7579]">{pending.uploadDone ? "Uploaded." : "Uploading…"}</p>
                )
              ) : (
                <p className="text-xs text-[#7B7579]">Credits are based on the video&apos;s real length, calculated once we fetch it.</p>
              )}
            </div>

            {generateError && <p className="text-xs text-[#B0503E]">{generateError}</p>}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || !rightsConfirmed || (pending.kind === "file" && !pending.uploadDone)}
                className="flex-1 py-3.5 px-6 rounded-full bg-[#ed8395] text-white font-semibold text-sm shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">content_cut</span>
                <span>{generating ? "Starting…" : pending.kind === "file" && !pending.uploadDone ? "Uploading…" : "Generate clips"}</span>
              </button>
              <button
                type="button"
                onClick={handleCancelPending}
                disabled={generating}
                className="px-5 py-3.5 rounded-full border border-[#ECE5E6] text-sm font-medium text-[#1d1b1e] hover:bg-[#FAF8F7] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>
          </div>
        </section>
      ) : (
        /* Combined entry card. The upload icon always opens the file-upload flow. The URL field
           is real now — the worker downloads whatever's pasted there (see worker/src/ytdlp.ts)
           and then treats it identically to an uploaded file. Submitting either one opens the
           configure step above instead of queuing immediately. */
        <section className="mb-8 space-y-3">
          <form onSubmit={handleUrlSubmit} className="space-y-3">
            <div className="bg-white rounded-2xl p-2 pl-2.5 pr-2.5 border border-[#ECE5E6] shadow-[0_2px_8px_-2px_rgba(42,39,42,0.04),0_8px_24px_-4px_rgba(42,39,42,0.06)] flex items-center gap-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,.mov,.avi,.mkv,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska"
                multiple
                onChange={handleFilesPicked}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFiles}
                aria-label="Choose video files to upload"
                className="w-11 h-11 rounded-xl bg-[#FAF8F7] text-[#9a4153] flex items-center justify-center shrink-0 hover:bg-[#fdd5e1]/60 transition-colors active:scale-95 duration-150 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {uploadingFiles ? (
                  <span className="w-4 h-4 rounded-full border-2 border-[#ECE5E6] border-t-[#9a4153] animate-spin" />
                ) : (
                  <span className="material-symbols-outlined text-[22px]">cloud_upload</span>
                )}
              </button>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                disabled={uploadingFiles}
                placeholder="Paste a YouTube or Twitch link…"
                className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm text-[#1d1b1e] placeholder:text-[#B3ACA6] focus:ring-0 focus:outline-none disabled:cursor-not-allowed"
              />
            </div>

            {fileUploadError && <p className="text-xs text-[#B0503E] px-1">{fileUploadError}</p>}
            {urlError && <p className="text-xs text-[#B0503E] px-1">{urlError}</p>}

            <div className="flex items-start gap-2 px-1 text-[#7B7579]">
              <span className="material-symbols-outlined text-[15px] mt-0.5 text-[#B3ACA6] shrink-0">info</span>
              <p className="text-[11px] leading-normal">Videos must be 5 minutes to 3 hours long. MP4, MOV, AVI, and MKV up to 5GB.</p>
            </div>

            <button
              type="submit"
              disabled={uploadingFiles}
              className="w-full py-3.5 px-6 rounded-full bg-[#ed8395] text-white font-semibold text-sm shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">content_cut</span>
              <span>
                {billing.ready
                  ? `Get Clips · ${
                      billing.hasActivePlan && billing.planCredits > 0
                        ? `${billing.planCredits} left`
                        : `${billing.freeCredits + billing.paidCredits} left`
                    }`
                  : "Get Clips"}
              </span>
            </button>
          </form>
        </section>
      )}

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[#1d1b1e]">All Projects ({projects.length})</h2>
      </div>

      {loadState === "loading" && <p className="text-sm text-[#7B7579]">Loading your projects…</p>}

      {loadState === "error" && (
        <div className="rounded-2xl border border-[#EF4444]/20 bg-[#EF4444]/[0.04] p-5 text-sm text-[#B0503E]">
          <p className="font-medium mb-1">Couldn&apos;t load your projects.</p>
          <p className="text-xs opacity-80">{loadError}</p>
        </div>
      )}

      {loadState === "loaded" && projects.length === 0 && (
        <div className="rounded-2xl border border-[#ECE5E6] bg-white py-16 text-center">
          <p className={`${playfair.className} text-lg text-[#1d1b1e] mb-1`}>No projects yet</p>
          <p className="text-sm text-[#7B7579]">Paste a link or upload a video above to start a cut.</p>
        </div>
      )}

      {loadState === "loaded" && projects.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} onDeleted={handleDeleted} />
          ))}
        </div>
      )}

      <div className="mt-8 pt-5 border-t border-[#ECE5E6] flex items-center justify-between gap-3">
        <Link
          href="/pricing"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#fdd5e1] text-[#9a4153] text-sm font-semibold hover:bg-[#f6c3d3] transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">bolt</span>
          <span>Go Pro</span>
        </Link>

        {billing.ready && (
          <span className="text-sm text-[#7B7579]">
            {billing.hasActivePlan
              ? `${billing.planCredits} credit${billing.planCredits === 1 ? "" : "s"} left this month`
              : billing.paidCredits > 0
                ? `${billing.freeCredits + billing.paidCredits} credits left`
                : `${billing.freeCredits}/${FREE_CREDITS_GRANT} credits left`}
          </span>
        )}
      </div>
    </DashboardShell>
  );
}
