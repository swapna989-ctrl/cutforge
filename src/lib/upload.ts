export const ALLOWED_VIDEO_EXTENSIONS = ["mp4", "mov", "avi", "mkv"];
export const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
export const MIN_VIDEO_SECONDS = 5 * 60; // 5 minutes
export const MAX_VIDEO_SECONDS = 3 * 60 * 60; // 3 hours

function fileExtension(fileName: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return match ? match[1].toLowerCase() : "";
}

/** Format + size are checked synchronously off the File object itself, no I/O needed.
 *  Duration needs the file's real metadata — see validateVideoDuration below, which requires
 *  actually reading it and so needs its own async pass before upload starts. */
export function validateVideoFileBasics(file: File): string | null {
  if (!ALLOWED_VIDEO_EXTENSIONS.includes(fileExtension(file.name))) {
    return `"${file.name}" isn't a supported format — upload MP4, MOV, AVI, or MKV.`;
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return `"${file.name}" is larger than the 5GB limit.`;
  }
  return null;
}

/** Null duration means the browser couldn't read the file's metadata (this happens for some
 *  AVI/MKV containers Chrome doesn't natively demux) — in that case we let it through rather
 *  than falsely rejecting a file we simply couldn't measure client-side. */
export function validateVideoDuration(file: File, durationSeconds: number | null): string | null {
  if (durationSeconds == null) return null;
  if (durationSeconds < MIN_VIDEO_SECONDS) {
    return `"${file.name}" is too short — videos must be at least 5 minutes long.`;
  }
  if (durationSeconds > MAX_VIDEO_SECONDS) {
    return `"${file.name}" is too long — videos must be under 3 hours.`;
  }
  return null;
}

/** Reads a File's real duration off a throwaway (never-rendered) video element. Null, not
 *  invented, when a browser genuinely can't report it (e.g. certain webm files). */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    video.src = url;
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
  });
}

/** Requests a presigned R2 upload URL for one file and PUTs it there, returning the object key. */
export async function uploadClipToR2(file: File): Promise<string> {
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

  return key;
}
