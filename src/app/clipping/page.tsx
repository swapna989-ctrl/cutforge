"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import DashboardShell from "@/components/DashboardShell";
import ProjectCard from "@/components/ProjectCard";
import { useRequireAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { useBilling } from "@/lib/billing";
import { readVideoDuration, uploadClipToR2, validateVideoFileBasics, validateVideoDuration } from "@/lib/upload";
import { listProjects, createProject, createProjectClip, updateProject, deleteProject, type Project } from "@/lib/projects";

// A project sits in one of these while the worker is actively on it — used to decide whether
// this page's own poll loop needs to keep running.
const IN_PROGRESS_STATUSES = ["ingesting", "queued", "synthesizing"];

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });

// The real signup grant every new account gets (supabase/migrations/0002_billing.sql) — the
// only fixed "total" that actually exists for credits. Paid packs (10/30/100) have no fixed
// total to compare against, so "X of Y" only means something for the free-tier count.
const FREE_CREDITS_GRANT = 5;

export default function ClippingPage() {
  const { ready, user } = useRequireAuth();
  const { prefs, ready: prefsReady } = usePrefs();
  const billing = useBilling();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [submittingUrl, setSubmittingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      } catch {
        // Transient — the next tick tries again rather than surfacing a poll-loop error.
      }
    }, 3000);

    return () => clearInterval(interval);
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

    // Charged once per video submitted, not per short downloaded — this is the point where
    // watermark-free-ness is already being decided (below), and it's what actually buys the
    // real work: AI planning + rendering up to 5 shorts from this one source.
    const { error: creditError } = await billing.consumeExportCredit();
    if (creditError) {
      setFileUploadError(creditError);
      setUploadingFiles(false);
      return;
    }

    let createdProjectId: string | null = null;

    try {
      const firstKey = await uploadClipToR2(files[0]);

      // Starts as "ingesting" (not "queued" yet) purely so the worker's claimNextJob — which
      // only picks up "queued" rows — can never grab this project while later files in a
      // multi-file batch are still being uploaded and their project_clips rows still being
      // written below. Flipped to "queued" only once everything is really in place.
      const created = await createProject({
        name: files[0].name,
        ratio: prefsReady ? prefs.defaultRatio : "9:16",
        pipelineStatus: "ingesting",
        progress: 0,
        sourceKey: firstKey,
        watermark: !billing.isWatermarkFree,
      });
      createdProjectId = created.id;

      await createProjectClip({ projectId: created.id, position: 0, sourceKey: firstKey, fileName: files[0].name, duration: durations[0] });

      for (let i = 1; i < files.length; i++) {
        const key = await uploadClipToR2(files[i]);
        await createProjectClip({ projectId: created.id, position: i, sourceKey: key, fileName: files[i].name, duration: durations[i] });
      }

      await updateProject(created.id, { pipelineStatus: "queued" });

      // Stay on this page — the new card shows real live progress (polled above) right in the
      // list, the same place every other project lives, instead of jumping to a separate screen
      // that has nothing to show yet.
      setProjects((prev) => [{ ...created, pipelineStatus: "queued", status: "draft" }, ...prev]);
      setUploadingFiles(false);
    } catch (err) {
      if (createdProjectId) deleteProject(createdProjectId).catch(() => {});
      setFileUploadError(err instanceof Error ? err.message : "Upload failed");
      setUploadingFiles(false);
    }
  }

  // The combined bar's one action: a pasted link starts a real link-ingestion project (the
  // worker downloads it — see worker/src/ytdlp.ts). Getting clips with neither a link typed nor
  // a file already picked (that flow is separate — see the upload icon's own onClick) is a
  // validation error, not an implicit fallback into a different flow.
  async function handleUrlSubmit(e: FormEvent) {
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

    setSubmittingUrl(true);

    // Same rule as the file-upload path: 1 credit per video submitted, not per short downloaded.
    const { error: creditError } = await billing.consumeExportCredit();
    if (creditError) {
      setUrlError(creditError);
      setSubmittingUrl(false);
      return;
    }

    try {
      const created = await createProject({
        name: trimmed,
        ratio: prefsReady ? prefs.defaultRatio : "9:16",
        pipelineStatus: "queued",
        progress: 0,
        sourceUrl: trimmed,
        watermark: !billing.isWatermarkFree,
      });
      setProjects((prev) => [created, ...prev]);
      setUrlInput("");
      setSubmittingUrl(false);
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "Could not start this project");
      setSubmittingUrl(false);
    }
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
          Paste a link or upload your footage — CutForge finds the best moments and turns them into ready-to-post
          shorts.
        </p>
      </section>

      {/* Combined entry card. The upload icon always opens the file-upload flow. The URL field
          is real now — the worker downloads whatever's pasted there (see worker/src/ytdlp.ts)
          and then treats it identically to an uploaded file. The primary button does whichever
          of the two makes sense: submits the link if one's been typed, otherwise opens upload. */}
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
              disabled={submittingUrl || uploadingFiles}
              placeholder="Paste a YouTube or Twitch link…"
              className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm text-[#1d1b1e] placeholder:text-[#B3ACA6] focus:ring-0 focus:outline-none disabled:cursor-not-allowed"
            />
          </div>

          {uploadingFiles && <p className="text-xs text-[#7B7579] px-1">Uploading your video…</p>}
          {fileUploadError && <p className="text-xs text-[#B0503E] px-1">{fileUploadError}</p>}
          {urlError && <p className="text-xs text-[#B0503E] px-1">{urlError}</p>}

          <div className="flex items-start gap-2 px-1 text-[#7B7579]">
            <span className="material-symbols-outlined text-[15px] mt-0.5 text-[#B3ACA6] shrink-0">info</span>
            <p className="text-[11px] leading-normal">Videos must be 5 minutes to 3 hours long. MP4, MOV, AVI, and MKV up to 5GB.</p>
          </div>

          <button
            type="submit"
            disabled={submittingUrl || uploadingFiles}
            className="w-full py-3.5 px-6 rounded-full bg-[#ed8395] text-white font-semibold text-sm shadow-[0_6px_18px_-3px_rgba(237,131,149,0.35)] hover:bg-[#9a4153] transition-all duration-150 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">content_cut</span>
            <span>
              {submittingUrl
                ? "Starting…"
                : billing.ready
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
              ? `${billing.planCredits} clip${billing.planCredits === 1 ? "" : "s"} left this month`
              : billing.paidCredits > 0
                ? `${billing.freeCredits + billing.paidCredits} credits left`
                : `${billing.freeCredits}/${FREE_CREDITS_GRANT} credits left`}
          </span>
        )}
      </div>
    </DashboardShell>
  );
}
