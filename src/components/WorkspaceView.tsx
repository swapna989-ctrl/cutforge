"use client";

import { useEffect, useRef, useState } from "react";
import WorkspaceShell from "@/components/WorkspaceShell";
import MediaStage from "@/components/MediaStage";
import ExportPanel, { type ExportSnapshot } from "@/components/ExportPanel";
import type { PipelineStatus, Ratio } from "@/lib/pipeline";
import { createProject, updateProject, deleteProject, getProject, type Project } from "@/lib/projects";
import { usePrefs } from "@/lib/prefs";
import { useBilling } from "@/lib/billing";

export default function WorkspaceView({ initialProject }: { initialProject?: Project }) {
  const { prefs, ready: prefsReady } = usePrefs();
  const billing = useBilling();
  // The real Supabase row id backing this session, once ingest has created one.
  const projectIdRef = useRef<string | null>(initialProject?.id ?? null);
  // Tracks the current local blob: URL so it can be revoked (avoids leaking memory) whenever
  // it's replaced or the component unmounts — the browser never frees these on its own.
  const localPreviewUrlRef = useRef<string | null>(null);

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

  // The footage the preview actually plays: the user's own just-picked file until the real
  // master exists, then the real rendered output — never a decorative stand-in for either.
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [realPreviewUrl, setRealPreviewUrl] = useState<string | null>(null);

  const [downloadState, setDownloadState] = useState<"idle" | "preparing" | "done">("idle");
  const [exportSnapshot, setExportSnapshot] = useState<ExportSnapshot | null>(null);
  const downloadInFlightRef = useRef(false);

  // Pick up the user's saved default ratio for brand-new (non-resumed) projects, once prefs load.
  useEffect(() => {
    if (!initialProject && prefsReady) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRatio(prefs.defaultRatio);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to prefs becoming ready, not every prefs change
  }, [prefsReady]);

  // Revoke the local blob: URL whenever it's replaced or the workspace unmounts.
  useEffect(() => {
    return () => {
      if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    };
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

  async function handleFile(file: File) {
    // Shows the user's real footage immediately, entirely client-side — no need to wait for
    // upload or processing to see the actual clip they just picked.
    if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    const objectUrl = URL.createObjectURL(file);
    localPreviewUrlRef.current = objectUrl;
    setLocalPreviewUrl(objectUrl);
    setDuration(null);
    setFileSizeBytes(file.size);
    setFileName(file.name);
    setStatus("ingesting");
    setUploadError(null);
    setErrorMessage(null);

    try {
      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type || "video/mp4" }),
      });
      if (!urlRes.ok) {
        const body = await urlRes.json().catch(() => null);
        throw new Error(body?.error ?? "Could not prepare upload");
      }
      const { uploadUrl, key } = (await urlRes.json()) as { uploadUrl: string; key: string };

      const putRes = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "video/mp4" } });
      if (!putRes.ok) throw new Error("Upload to storage failed");

      const created = await createProject({
        name: file.name,
        ratio,
        pipelineStatus: "queued",
        progress: 0,
        sourceKey: key,
        watermark: !billing.isWatermarkFree,
      });
      projectIdRef.current = created.id;
      setStatusMessage(null);
      setStatus("queued");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      setStatus("idle");
      setFileName(null);
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
    setStatus("idle");
    setFileName(null);
    setFileSizeBytes(null);
    setDuration(null);
    setLocalPreviewUrl(null);
    setRealPreviewUrl(null);
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

    // Snapshot what this export will look like *before* consumeExportCredit mutates billing
    // state, so the delivered master's watermark/credit display can't retroactively change.
    // Note this is just the preview label — the file itself was already rendered watermarked
    // or not, decided once at upload time (see projects.watermark).
    const watermarkFree = billing.isWatermarkFree;
    const label = watermarkFree
      ? billing.hasActivePlan
        ? "No watermark · unlimited exports on your plan"
        : `No watermark · ${billing.paidCredits - 1} paid credit${billing.paidCredits - 1 === 1 ? "" : "s"} left`
      : `Includes CutForge watermark (${billing.freeCredits - 1} free export${billing.freeCredits - 1 === 1 ? "" : "s"} left)`;

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
        const { error } = await billing.consumeExportCredit();
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

  return (
    <WorkspaceShell projectName={fileName} status={status}>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center p-1 rounded-full bg-[#141418] border border-white/10 shadow-inner">
            <button
              onClick={() => handleSetRatio("9:16")}
              className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-300 select-none flex items-center space-x-1.5 cursor-pointer ${
                ratio === "9:16" ? "bg-[#fbf6ee] text-[#08080a] shadow-[0_0_16px_rgba(244,213,141,0.35)] font-semibold" : "text-zinc-400 hover:text-white"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">stay_current_portrait</span>
              <span>9:16</span>
            </button>
            <button
              onClick={() => handleSetRatio("16:9")}
              className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all duration-300 select-none flex items-center space-x-1.5 cursor-pointer ${
                ratio === "16:9" ? "bg-[#fbf6ee] text-[#08080a] shadow-[0_0_16px_rgba(244,213,141,0.35)] font-semibold" : "text-zinc-400 hover:text-white"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">crop_16_9</span>
              <span>16:9</span>
            </button>
          </div>
        </div>

        {uploadError && <p className="text-center text-xs text-red-400 font-mono">{uploadError}</p>}
        {downloadError && <p className="text-center text-xs text-red-400 font-mono">{downloadError}</p>}

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
          onFile={handleFile}
          onReset={handleReset}
          onDurationLoaded={setDuration}
        />

        <ExportPanel
          status={status}
          downloadState={downloadState}
          exportSnapshot={exportSnapshot}
          onReEdit={handleReset}
          onDownload={handleDownload}
        />
      </div>
    </WorkspaceShell>
  );
}
