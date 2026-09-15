"use client";

import { useEffect, useRef, useState } from "react";
import WorkspaceShell from "@/components/WorkspaceShell";
import MediaStage, { type ClipStripItem } from "@/components/MediaStage";
import ExportPanel, { type ExportSnapshot } from "@/components/ExportPanel";
import ShortsGallery from "@/components/ShortsGallery";
import type { PipelineStatus, Ratio } from "@/lib/pipeline";
import {
  createProject,
  createProjectClip,
  updateProjectClip,
  deleteProjectClip,
  listProjectClips,
  updateProject,
  deleteProject,
  getProject,
  listShorts,
  type Project,
  type Short,
} from "@/lib/projects";
import { usePrefs } from "@/lib/prefs";
import { useBilling } from "@/lib/billing";
import { creditsForDuration } from "@/lib/pricing";
import { readVideoDuration, uploadClipToR2, MAX_VIDEO_SECONDS } from "@/lib/upload";

export default function WorkspaceView({ initialProject }: { initialProject?: Project }) {
  const { prefs, ready: prefsReady } = usePrefs();
  const billing = useBilling();
  // The real Supabase row id backing this session, once ingest has created one.
  const projectIdRef = useRef<string | null>(initialProject?.id ?? null);
  // Tracks the current local blob: URL so it can be revoked (avoids leaking memory) whenever
  // it's replaced or the component unmounts — the browser never frees these on its own.
  const localPreviewUrlRef = useRef<string | null>(null);
  // Every per-clip blob: URL created for the clip strip's thumbnails, so they can all be
  // revoked together on reset/unmount the same way localPreviewUrlRef is.
  const clipPreviewUrlsRef = useRef<string[]>([]);

  const [ratio, setRatio] = useState<Ratio>(initialProject?.ratio ?? "9:16");

  const [status, setStatus] = useState<PipelineStatus>(initialProject?.pipelineStatus ?? "idle");
  const [fileName, setFileName] = useState<string | null>(initialProject?.name ?? null);
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [progress, setProgress] = useState(initialProject?.progress ?? 0);
  const [statusMessage, setStatusMessage] = useState<string | null>(initialProject?.statusMessage ?? null);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialProject?.errorMessage ?? null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipStripItem[]>([]);
  // True once every selected clip is uploaded and recorded, but before the user has confirmed
  // processing — the window remove/replace/add operate in. The project's own pipeline_status
  // stays "ingesting" throughout (no schema change needed); this is purely local UI state.
  const [reviewing, setReviewing] = useState(false);

  // The footage the preview actually plays: the user's own just-picked file until the real
  // master exists, then the real rendered output — never a decorative stand-in for either.
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [realPreviewUrl, setRealPreviewUrl] = useState<string | null>(null);

  const [downloadState, setDownloadState] = useState<"idle" | "preparing" | "done">("idle");
  const [exportSnapshot, setExportSnapshot] = useState<ExportSnapshot | null>(null);
  const downloadInFlightRef = useRef(false);

  // The AI Clip Planner's real output for this project — populated once the pipeline finishes.
  // A "ready" project with zero shorts is a legacy single-output project from before the planner
  // existed; that case keeps falling through to the MediaStage/ExportPanel preview below exactly
  // as it did before this existed.
  const [shorts, setShorts] = useState<Short[]>([]);
  // Resuming an already-"ready" project starts `shorts` at [] before the real fetch below has
  // had a chance to run — without this flag, that brief real gap reads as "no shorts, fall back
  // to the legacy single-output view" and flashes it before flipping to the gallery.
  const [shortsChecked, setShortsChecked] = useState(false);

  // Pick up the user's saved default ratio for brand-new (non-resumed) projects, once prefs load.
  useEffect(() => {
    if (!initialProject && prefsReady) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRatio(prefs.defaultRatio);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to prefs becoming ready, not every prefs change
  }, [prefsReady]);

  // Revoke the local blob: URLs whenever the workspace unmounts.
  useEffect(() => {
    return () => {
      if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
      clipPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // Resuming an existing project: fetch its real clips so the strip reflects what's actually
  // there. No local File objects exist in this case, so thumbnails fall back to a plain icon
  // (see ClipStripItem) rather than inventing a preview. A project from before multi-clip
  // support has no project_clips rows at all — fall back to one item built from the project's
  // own name so it still shows *something*, matching what used to be displayed here. A project
  // still sitting at "ingesting" (selected and uploaded, but Process was never clicked before
  // the user navigated away) drops back into the same review tray instead of silently losing it.
  useEffect(() => {
    if (!initialProject) return;
    let cancelled = false;
    listProjectClips(initialProject.id)
      .then((rows) => {
        if (cancelled) return;
        if (rows.length > 0) {
          setClips(rows.map((r) => ({ id: r.id, fileName: r.fileName, position: r.position, previewUrl: null })));
          if (initialProject.pipelineStatus === "ingesting") setReviewing(true);
        } else if (initialProject.pipelineStatus !== "ingesting") {
          setClips([{ id: "legacy", fileName: initialProject.name, position: 0, previewUrl: null }]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only ever runs for the project this workspace was opened with
  }, []);

  // Fetches a real, playable URL for the finished master — the same endpoint the download
  // button uses, but calling it alone (with no consumeExportCredit call) has no billing
  // side-effect, so watching the result costs nothing. Covers both the live "just finished"
  // transition and resuming an already-ready project from the dashboard.
  useEffect(() => {
    if (status !== "ready" || realPreviewUrl) return;
    const id = projectIdRef.current;
    if (!id) return;
    let cancelled = false;
    fetch(`/api/download-url?projectId=${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { downloadUrl: string } | null) => {
        if (!cancelled && body?.downloadUrl) setRealPreviewUrl(body.downloadUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status, realPreviewUrl]);

  // Fetches the real shorts the worker planned and rendered for this project, once it's ready.
  // Covers both the live "just finished" transition and resuming an already-ready project.
  useEffect(() => {
    if (status !== "ready") return;
    const id = projectIdRef.current;
    if (!id) return;
    let cancelled = false;
    listShorts(id)
      .then((rows) => {
        if (cancelled) return;
        setShorts(rows);
        setShortsChecked(true);
      })
      .catch(() => {
        if (!cancelled) setShortsChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  // Poll the real project row while a worker could plausibly be acting on it. The worker
  // processes jobs in the background regardless of whether anyone's watching, so this is
  // genuinely "what's the current state", not a client-driven simulation.
  useEffect(() => {
    if (status !== "queued" && status !== "synthesizing") return;
    const id = projectIdRef.current;
    if (!id) return;

    const interval = setInterval(async () => {
      try {
        const project = await getProject(id);
        if (!project) return;

        setProgress(project.progress);
        if (project.statusMessage) setStatusMessage(project.statusMessage);

        if (project.pipelineStatus === "failed") {
          setErrorMessage(project.errorMessage);
          setStatus("failed");
        } else if (project.pipelineStatus === "ready") {
          setStatus("ready");
        } else if (project.pipelineStatus !== status) {
          setStatus(project.pipelineStatus);
        }
      } catch (err) {
        console.error("Poll failed:", err);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [status]);

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;

    // Shows the user's real footage immediately, entirely client-side — no need to wait for
    // upload or processing to see the actual clip they just picked. The big preview above the
    // strip still only ever plays the first clip (or, once ready, the real rendered master) —
    // this isn't a multi-clip editor yet, just an accurate view of what's been uploaded.
    if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    const objectUrl = URL.createObjectURL(files[0]);
    localPreviewUrlRef.current = objectUrl;
    setLocalPreviewUrl(objectUrl);
    setDuration(null);
    setFileSizeBytes(files[0].size);
    setFileName(files[0].name);
    setStatus("ingesting");
    setReviewing(false);
    setUploadError(null);
    setErrorMessage(null);
    clipPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    clipPreviewUrlsRef.current = [];
    setClips([]);

    // Tracks the project row so a failure partway through can roll it back (cascade-deletes
    // any project_clips rows already inserted) instead of leaving a half-uploaded draft behind.
    let createdProjectId: string | null = null;

    try {
      const firstDuration = await readVideoDuration(files[0]);
      const firstKey = await uploadClipToR2(files[0]);

      // The first clip creates the project, exactly like the single-file flow always has —
      // source_key is still populated from it, so anything reading that column directly keeps
      // working. Left at "ingesting" rather than "queued" — "queued" is what tells the worker
      // this job is ready to claim, and it should only get that once the user actually confirms
      // via Process, not the instant every file happens to finish uploading.
      const created = await createProject({
        name: files[0].name,
        ratio,
        captionStyle: prefsReady ? prefs.defaultCaptionStyle : "classic",
        captionLanguage: prefsReady ? prefs.defaultCaptionLanguage : "auto",
        pipelineStatus: "ingesting",
        progress: 0,
        sourceKey: firstKey,
        // Placeholder for a real (post-AI-Clip-Planner) project — the worker decides the real
        // value once it charges for this project's actual duration (see charge_project_credits).
        // Only ever overridden by handleDownload below for a legacy zero-shorts project.
        watermark: true,
      });
      createdProjectId = created.id;
      projectIdRef.current = created.id;

      const firstRow = await createProjectClip({
        projectId: created.id,
        position: 0,
        sourceKey: firstKey,
        fileName: files[0].name,
        duration: firstDuration,
      });
      const firstPreviewUrl = URL.createObjectURL(files[0]);
      clipPreviewUrlsRef.current.push(firstPreviewUrl);
      setClips([{ id: firstRow.id, fileName: files[0].name, position: 0, previewUrl: firstPreviewUrl }]);

      for (let i = 1; i < files.length; i++) {
        const clipDuration = await readVideoDuration(files[i]);
        const key = await uploadClipToR2(files[i]);
        const row = await createProjectClip({
          projectId: created.id,
          position: i,
          sourceKey: key,
          fileName: files[i].name,
          duration: clipDuration,
        });
        const previewUrl = URL.createObjectURL(files[i]);
        clipPreviewUrlsRef.current.push(previewUrl);
        setClips((prev) => [...prev, { id: row.id, fileName: files[i].name, position: i, previewUrl }]);
      }

      // Every clip is uploaded and recorded — hand it to the user to review before anything
      // is queued for the worker.
      setStatusMessage(null);
      setReviewing(true);
    } catch (err) {
      // R2 objects already uploaded for earlier clips in this batch aren't deleted here — there's
      // no delete-object capability anywhere in the current architecture (upload/download only
      // ever presign PUT/GET), so removing one would mean adding new backend surface this step
      // wasn't scoped to add. The project row (and any project_clips rows already attached to it
      // via cascade) is rolled back, which is what keeps the *visible* project list and the
      // worker's queue honest.
      if (createdProjectId) deleteProject(createdProjectId).catch(() => {});
      projectIdRef.current = null;
      clipPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      clipPreviewUrlsRef.current = [];
      setClips([]);
      setReviewing(false);
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      setStatus("idle");
      setFileName(null);
    }
  }

  /** Confirms the current clip selection and hands the job to the worker. */
  async function handleProcess() {
    const id = projectIdRef.current;
    if (!id || clips.length === 0) return;
    try {
      await updateProject(id, { pipelineStatus: "queued" });
      setReviewing(false);
      setStatusMessage(null);
      setStatus("queued");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not start processing");
    }
  }

  /** Removes one clip from the current (not-yet-processed) selection and closes the gap in
   *  position order. Purely a selection edit — nothing here touches the worker or the queue. */
  async function handleRemoveClip(position: number) {
    const target = clips.find((c) => c.position === position);
    if (!target) return;

    if (target.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
      clipPreviewUrlsRef.current = clipPreviewUrlsRef.current.filter((u) => u !== target.previewUrl);
    }

    const remaining = clips.filter((c) => c.id !== target.id).sort((a, b) => a.position - b.position);

    if (remaining.length === 0) {
      // Nothing left to process — the same as abandoning this draft entirely.
      handleReset();
      return;
    }

    const renumbered = remaining.map((c, i) => ({ ...c, position: i }));
    setClips(renumbered);
    setFileName(renumbered[0].fileName);
    setLocalPreviewUrl(renumbered[0].previewUrl);
    setDuration(null);

    try {
      await deleteProjectClip(target.id);
      // Ascending order of the NEW position is always collision-safe here: removing one clip
      // only ever shifts the remaining ones to an equal-or-lower position, so by the time a row
      // is asked to take position N, whichever row used to hold N has already moved off it.
      for (const clip of renumbered) {
        await updateProjectClip(clip.id, { position: clip.position });
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not remove clip");
    }
  }

  /** Swaps the file behind one existing clip slot, keeping its position. Uses the same
   *  upload-url + PUT flow as initial selection — no new upload path. */
  async function handleReplaceClip(position: number, file: File) {
    const target = clips.find((c) => c.position === position);
    if (!target) return;

    let clipDuration: number | null;
    let key: string;
    try {
      clipDuration = await readVideoDuration(file);
      key = await uploadClipToR2(file);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not upload replacement clip");
      return;
    }

    try {
      await updateProjectClip(target.id, { sourceKey: key, fileName: file.name, duration: clipDuration });
      // Position 0 backs projects.source_key too (kept for backward compatibility with anything
      // still reading it directly) — keep it in sync with what's actually in that slot now.
      if (position === 0 && projectIdRef.current) {
        await updateProject(projectIdRef.current, { sourceKey: key });
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not replace clip");
      return;
    }

    const newPreviewUrl = URL.createObjectURL(file);
    if (target.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
      clipPreviewUrlsRef.current = clipPreviewUrlsRef.current.filter((u) => u !== target.previewUrl);
    }
    clipPreviewUrlsRef.current.push(newPreviewUrl);
    setClips((prev) => prev.map((c) => (c.id === target.id ? { ...c, fileName: file.name, previewUrl: newPreviewUrl } : c)));

    if (position === 0) {
      setFileName(file.name);
      setFileSizeBytes(file.size);
      setDuration(clipDuration);
      setLocalPreviewUrl(newPreviewUrl);
    }
  }

  /** Appends newly picked files to the end of the current selection, same upload path as the
   *  initial selection. */
  async function handleAddClips(files: File[]) {
    const id = projectIdRef.current;
    if (!id || files.length === 0) return;
    let nextPosition = clips.length;
    for (const file of files) {
      // A fresh const per iteration, not the shared `nextPosition` counter itself — setClips's
      // updater below runs later, once React actually applies it, and by then a *shared* mutable
      // variable would already reflect a later iteration's incremented value. Capturing it here
      // pins each clip to the value that was actually true when it was added.
      const clipPosition = nextPosition;
      nextPosition += 1;
      try {
        const clipDuration = await readVideoDuration(file);
        const key = await uploadClipToR2(file);
        const row = await createProjectClip({ projectId: id, position: clipPosition, sourceKey: key, fileName: file.name, duration: clipDuration });
        const previewUrl = URL.createObjectURL(file);
        clipPreviewUrlsRef.current.push(previewUrl);
        setClips((prev) => [...prev, { id: row.id, fileName: file.name, position: clipPosition, previewUrl }]);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Could not add clip");
        break;
      }
    }
  }

  function handleReset() {
    // "Replace clip" (and "Try again" after a failure) abandons whatever was ingested — delete
    // its row rather than leaving an orphaned draft behind.
    if (projectIdRef.current) {
      deleteProject(projectIdRef.current).catch(() => {});
      projectIdRef.current = null;
    }
    if (localPreviewUrlRef.current) {
      URL.revokeObjectURL(localPreviewUrlRef.current);
      localPreviewUrlRef.current = null;
    }
    clipPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    clipPreviewUrlsRef.current = [];
    setClips([]);
    setReviewing(false);
    setStatus("idle");
    setFileName(null);
    setFileSizeBytes(null);
    setDuration(null);
    setLocalPreviewUrl(null);
    setRealPreviewUrl(null);
    setShorts([]);
    setShortsChecked(false);
    setProgress(0);
    setStatusMessage(null);
    setErrorMessage(null);
    setUploadError(null);
    setDownloadError(null);
    setDownloadState("idle");
    setExportSnapshot(null);
    downloadInFlightRef.current = false;
  }

  function handleDownload() {
    // Guards against double-spending a credit on a double-click. A ref (not the downloadState
    // *value*) is what actually blocks re-entrancy, since React state updates aren't visible
    // synchronously — several clicks fired in the same tick would all still see the old
    // "idle" state and all pass a check against downloadState alone.
    const id = projectIdRef.current;
    if (!billing.ready || !billing.canExport || downloadInFlightRef.current || !id) return;
    downloadInFlightRef.current = true;
    setDownloadError(null);

    // Opened synchronously, in direct response to the click, so it still counts as a
    // user-initiated navigation once the real URL is ready a few `await`s later — Safari
    // (especially iOS) can refuse to treat a *later* location change as trusted and silently
    // block it, which is the main reason downloads have been unreliable on iPhone. We just
    // redirect this already-open tab once we have the real download URL.
    const downloadWindow = window.open("", "_blank");

    // This legacy flow (see the module doc comment above `shorts`) is the one remaining charge
    // that still happens client-side rather than in the worker — duration is whatever this
    // project's own upload reported, or (if that was never readable) the maximum a video is
    // allowed to be, so an unknown-length legacy video is never undercharged.
    const creditsNeeded = creditsForDuration(duration ?? MAX_VIDEO_SECONDS);

    // Snapshot what this export will look like *before* consumeExportCredit mutates billing
    // state, so the delivered master's watermark/credit display can't retroactively change.
    // Note this is just the preview label — the file itself was already rendered watermarked
    // or not, decided once at upload time (see projects.watermark).
    const watermarkFree = billing.isWatermarkFree;
    const label = watermarkFree
      ? billing.hasActivePlan && billing.planCredits >= creditsNeeded
        ? `No watermark · ${billing.planCredits - creditsNeeded} credit${billing.planCredits - creditsNeeded === 1 ? "" : "s"} left this month`
        : `No watermark · ${billing.paidCredits - creditsNeeded} paid credit${billing.paidCredits - creditsNeeded === 1 ? "" : "s"} left`
      : `Includes Flovura watermark (${billing.freeCredits - creditsNeeded} free export${billing.freeCredits - creditsNeeded === 1 ? "" : "s"} left)`;

    setDownloadState("preparing");
    (async () => {
      try {
        const res = await fetch(`/api/download-url?projectId=${id}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "Could not prepare download — the link may have expired. Please try again.");
        }
        const { downloadUrl } = (await res.json()) as { downloadUrl: string };

        // Server-enforced — this can genuinely fail (e.g. another tab spent the last credit in
        // the gap between the canExport check above and now), not just a local state update.
        const { error } = await billing.consumeExportCredit(creditsNeeded);
        if (error) {
          downloadWindow?.close();
          setDownloadState("idle");
          downloadInFlightRef.current = false;
          return;
        }

        if (downloadWindow) {
          downloadWindow.location.href = downloadUrl;
        } else {
          // Popup blocked (or window.open unsupported) — fall back to a same-tab navigation.
          // This still downloads correctly rather than previewing, since the URL itself now
          // carries a Content-Disposition: attachment header from the server.
          window.location.href = downloadUrl;
        }

        setExportSnapshot({ watermarkFree, label });
        setDownloadState("done");
        window.setTimeout(() => {
          setDownloadState("idle");
          downloadInFlightRef.current = false;
        }, 1700);
      } catch (err) {
        console.error(err);
        downloadWindow?.close();
        setDownloadError(err instanceof Error ? err.message : "Download failed. Please try again.");
        setDownloadState("idle");
        downloadInFlightRef.current = false;
      }
    })();
  }

  function handleSetRatio(next: Ratio) {
    setRatio(next);
    if (projectIdRef.current) {
      updateProject(projectIdRef.current, { ratio: next }).catch(() => {});
    }
  }

  // A resumed "ready" project starts with an empty shorts array before the real fetch above has
  // resolved — without this, that gap briefly renders as "no shorts, must be legacy" and flashes
  // the old MediaStage view before flipping to the gallery a moment later.
  const awaitingShortsCheck = status === "ready" && !shortsChecked;
  const showGallery = status === "ready" && shortsChecked && shorts.length > 0;

  return (
    <WorkspaceShell status={status}>
      <div className="space-y-5">
        {/* Changing ratio after clips already exist wouldn't do anything real — they're already
            rendered — so this only shows before that point (and not while it's still ambiguous
            whether this project even has any). */}
        {!showGallery && !awaitingShortsCheck && (
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center p-1 rounded-full bg-[#F5F1EA] border border-[#E8E2D6] shadow-inner">
              <button
                onClick={() => handleSetRatio("9:16")}
                className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-300 select-none flex items-center space-x-1.5 cursor-pointer ${
                  ratio === "9:16" ? "bg-[#A8724A] text-white shadow-[0_1px_3px_rgba(168,114,74,0.3)] font-semibold" : "text-[#8A8375] hover:text-[#2B2926]"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">stay_current_portrait</span>
                <span>9:16</span>
              </button>
              <button
                onClick={() => handleSetRatio("16:9")}
                className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-300 select-none flex items-center space-x-1.5 cursor-pointer ${
                  ratio === "16:9" ? "bg-[#A8724A] text-white shadow-[0_1px_3px_rgba(168,114,74,0.3)] font-semibold" : "text-[#8A8375] hover:text-[#2B2926]"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">crop_16_9</span>
                <span>16:9</span>
              </button>
            </div>
          </div>
        )}

        {uploadError && <p className="text-center text-xs text-[#B0503E] font-mono">{uploadError}</p>}
        {downloadError && <p className="text-center text-xs text-[#B0503E] font-mono">{downloadError}</p>}

        {awaitingShortsCheck ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 rounded-full border-2 border-[#E8E2D6] border-t-[#A8724A] animate-spin" />
          </div>
        ) : showGallery ? (
          <ShortsGallery projectId={projectIdRef.current!} shorts={shorts} onShortsChange={setShorts} />
        ) : (
          <>
            <MediaStage
              ratio={ratio}
              status={status}
              fileName={fileName}
              fileSizeBytes={fileSizeBytes}
              duration={duration}
              previewSrc={realPreviewUrl ?? localPreviewUrl}
              progress={progress}
              statusMessage={statusMessage}
              errorMessage={errorMessage}
              clips={clips}
              reviewing={reviewing}
              onFiles={handleFiles}
              onReset={handleReset}
              onDurationLoaded={setDuration}
              onRemoveClip={handleRemoveClip}
              onReplaceClip={handleReplaceClip}
              onAddClips={handleAddClips}
              onProcess={handleProcess}
            />

            <ExportPanel
              status={status}
              downloadState={downloadState}
              exportSnapshot={exportSnapshot}
              onReEdit={handleReset}
              onDownload={handleDownload}
            />
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
