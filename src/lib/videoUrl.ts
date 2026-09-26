// Mirrored in worker/src/videoUrl.ts -- keep the two in sync. This copy is a courtesy: it tells the
// user right away that a pasted link won't work, before any project exists. The worker's copy is the
// one that actually protects anything (a project's source_url is written by the browser, so the
// worker re-validates it before handing anything to yt-dlp).

export type VideoPlatform = "youtube" | "twitch";
export type VideoUrlCheck = { ok: true; platform: VideoPlatform; url: string } | { ok: false; message: string };

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);
const TWITCH_HOSTS = new Set(["twitch.tv", "www.twitch.tv", "m.twitch.tv"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const UNSUPPORTED = "Flovura works with YouTube and Twitch links — paste one of those, or upload the video file instead.";
const YOUTUBE_NOT_A_VIDEO = "That doesn't look like a link to a single YouTube video — open the video and paste its address.";
const YOUTUBE_PLAYLIST = "That's a playlist link. Open one video and paste its address instead.";
const YOUTUBE_CHANNEL = "That's a channel link. Open one video and paste its address instead.";
const TWITCH_CLIP = "Twitch clips are too short for Flovura, which needs at least 5 minutes of footage. Paste a link to a full past broadcast instead.";
const TWITCH_CHANNEL = "That's a Twitch channel link. Open a past broadcast and paste its address (it looks like twitch.tv/videos/123456789).";

const fail = (message: string): VideoUrlCheck => ({ ok: false, message });

export function parseVideoUrl(raw: string): VideoUrlCheck {
  const text = raw.trim();
  if (!text) return fail(UNSUPPORTED);

  let u: URL;
  try {
    u = new URL(text);
  } catch {
    try {
      // Pasted without the scheme ("youtube.com/watch?v=…").
      u = new URL(`https://${text}`);
    } catch {
      return fail(UNSUPPORTED);
    }
  }

  if (u.protocol !== "https:" && u.protocol !== "http:") return fail(UNSUPPORTED);
  if (u.username || u.password || u.port) return fail(UNSUPPORTED);

  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, "");

  if (YOUTUBE_HOSTS.has(host)) {
    let id: string | null = null;
    if (host === "youtu.be") id = path.slice(1).split("/")[0] || null;
    else if (path === "/watch") id = u.searchParams.get("v");
    else {
      const m = path.match(/^\/(?:shorts|live|embed|v)\/([^/]+)$/);
      if (m) id = m[1];
    }
    // A watch?v=…&list=… link is one video inside a playlist; the worker downloads just that video.
    if (id && YOUTUBE_ID.test(id)) return { ok: true, platform: "youtube", url: `https://www.youtube.com/watch?v=${id}` };

    if (path === "/playlist" || u.searchParams.has("list")) return fail(YOUTUBE_PLAYLIST);
    if (/^\/(?:@|channel\/|c\/|user\/)/.test(path)) return fail(YOUTUBE_CHANNEL);
    return fail(YOUTUBE_NOT_A_VIDEO);
  }

  if (host === "clips.twitch.tv") return fail(TWITCH_CLIP);

  if (TWITCH_HOSTS.has(host)) {
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "videos" && /^\d+$/.test(parts[1] ?? "")) {
      return { ok: true, platform: "twitch", url: `https://www.twitch.tv/videos/${parts[1]}` };
    }
    // Older /<channel>/video/<id> and /<channel>/v/<id> forms.
    if ((parts[1] === "video" || parts[1] === "v") && /^\d+$/.test(parts[2] ?? "")) {
      return { ok: true, platform: "twitch", url: `https://www.twitch.tv/videos/${parts[2]}` };
    }
    if (parts[1] === "clip") return fail(TWITCH_CLIP);
    return fail(TWITCH_CHANNEL);
  }

  return fail(UNSUPPORTED);
}

export const PLATFORM_LABEL: Record<VideoPlatform, string> = { youtube: "YouTube", twitch: "Twitch" };

/** YouTube's own thumbnail, guessable straight from the video id -- no API call, so it's ready to
 *  show the instant a link is pasted, well before the worker ever fetches anything. Twitch has no
 *  equivalent unauthenticated static URL, so this only ever returns something for a youtube link. */
export function youtubeThumbnailUrl(url: string): string | null {
  const m = url.match(/[?&]v=([A-Za-z0-9_-]{11})(?:&|$)/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null;
}

/** What a link project is called on the dashboard until the worker replaces it with the video's
 *  real title: the address without the scheme and www, e.g. "youtube.com/watch?v=aqz-KE-bpKQ". */
export function shortLabel(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "");
}
