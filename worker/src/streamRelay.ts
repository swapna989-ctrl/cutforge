// A small web server that only ever listens on this machine (127.0.0.1) and stands between ffmpeg and a
// video site's stream.
//
// Why it exists: ffmpeg used to open the site's stream addresses itself. That worked on a developer's
// laptop and failed on Railway (every clip: "couldn't fetch this part of the video"), and the same
// approach failed once locally with a 403 -- ffmpeg's own HTTPS, certificate handling, DNS and proxy
// support are the least controllable part of the pipeline, and its requests are also the kind YouTube
// throttles (measured: ~2x real time, so a 45 s clip took 21 s to read). Node's HTTPS is what already
// talks to OpenAI, Supabase and R2 from Railway, so Node fetches the bytes and ffmpeg only ever speaks
// plain HTTP to localhost.
//
// What it does for ffmpeg, per request:
//   - a stream file (YouTube's video/audio, seekable by byte range): answers ffmpeg's Range requests by
//     fetching the same range upstream in chunks (which also avoids YouTube's throttling of one long
//     request), retrying a chunk that fails for a passing reason;
//   - an HLS playlist (Twitch): fetches it, rewrites every segment address to point back here, so the
//     segments come through here too.
// It also counts the bytes it fetches, which is what a per-gigabyte proxy actually bills.

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { request as httpsRequest } from "node:https";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { HttpsProxyAgent } from "https-proxy-agent";

/** One upstream request asks for at most this much. It avoids a video site's throttling of one long read,
 *  and it bounds waste: when ffmpeg has what it needs and stops, whatever was already in flight for the
 *  current chunk has still been sent (and a per-gigabyte proxy bills it). Measured with an 8 MB chunk, a
 *  5-second cut carried 9.8 MB through the proxy for 6.6 MB actually used; 1 MB keeps the overshoot
 *  to about a megabyte per stream per clip, while a request round trip is still small next to it. */
const CHUNK_BYTES = 1024 * 1024;
const MAX_TRIES = 3;
const SOCKET_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 4;

export type RelaySource = {
  url: string;
  /** The request headers the site expects (yt-dlp reports them alongside the address). */
  headers: Record<string, string>;
  /** Reach the site through this proxy (http://user:pass@host:port), or directly when null. */
  proxy: string | null;
  /** An HLS playlist rather than a single seekable file. */
  hls: boolean;
};

export type RegisteredStream = {
  /** The address to hand to ffmpeg. */
  url: string;
  /** Bytes fetched from the site so far for this stream. */
  bytesFetched(): number;
  /** Forget the stream (the server itself stays up for the next job). */
  dispose(): void;
};

type Entry = { source: RelaySource; bytes: number; totalBytes: number | null; children: Set<string> };

class UpstreamError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const agents = new Map<string, HttpsProxyAgent<string>>();
function agentFor(proxy: string | null): HttpsProxyAgent<string> | undefined {
  if (!proxy) return undefined;
  let agent = agents.get(proxy);
  if (!agent) {
    agent = new HttpsProxyAgent(proxy, { keepAlive: true });
    agents.set(proxy, agent);
  }
  return agent;
}

/** One request to the site; resolves once the response headers are in. Follows redirects. */
function upstreamOnce(url: string, headers: Record<string, string>, proxy: string | null, signal: AbortSignal, redirects = 0): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(target, { method: "GET", headers, agent: agentFor(proxy), signal }, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new UpstreamError(status, "too many redirects"));
        return upstreamOnce(new URL(res.headers.location, target).toString(), headers, proxy, signal, redirects + 1).then(resolve, reject);
      }
      resolve(res);
    });
    req.setTimeout(SOCKET_TIMEOUT_MS, () => req.destroy(new Error("upstream timed out")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * A request that is retried when it fails for a reason that passes by itself (a dropped connection, a
 * timeout, a 5xx or 429). A 4xx such as 403 is final: the address is refused or has expired, and asking
 * again won't change that.
 */
async function upstream(url: string, headers: Record<string, string>, proxy: string | null, signal: AbortSignal, accept: number[]): Promise<IncomingMessage> {
  let last: unknown;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    if (signal.aborted) throw new Error("aborted");
    try {
      const res = await upstreamOnce(url, headers, proxy, signal);
      const status = res.statusCode ?? 0;
      if (accept.includes(status)) return res;
      res.resume();
      if (status < 500 && status !== 429) throw new UpstreamError(status, `upstream answered ${status}`);
      last = new UpstreamError(status, `upstream answered ${status}`);
    } catch (err) {
      if (err instanceof UpstreamError && err.status < 500 && err.status !== 429) throw err;
      if (signal.aborted) throw err;
      last = err;
    }
    if (attempt < MAX_TRIES) await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

const registry = new Map<string, Entry>();
/** Segment/sub-playlist addresses handed out while rewriting an HLS playlist -> where they really are. */
const children = new Map<string, { url: string; owner: string }>();

let serverPromise: Promise<{ server: Server; port: number }> | null = null;

function getServer(): Promise<{ server: Server; port: number }> {
  if (!serverPromise) {
    serverPromise = new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        handle(req, res).catch((err) => {
          if (!res.headersSent) {
            res.writeHead(err instanceof UpstreamError && err.status === 403 ? 403 : 502).end();
          } else {
            res.destroy(err instanceof Error ? err : new Error(String(err)));
          }
        });
      });
      server.on("error", reject);
      // Port 0 = any free port; 127.0.0.1 = reachable only from this machine.
      server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port }));
      server.unref();
    });
  }
  return serverPromise;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0];
  const [, kind, rest] = path.split("/");
  const id = (rest ?? "").replace(/\.[a-z0-9]+$/i, "");

  const abort = new AbortController();
  res.on("close", () => abort.abort());

  if (kind === "s" || kind === "h") {
    const entry = registry.get(id);
    if (!entry) return void res.writeHead(404).end();
    return kind === "h" ? servePlaylist(entry, entry.source.url, id, res, abort.signal) : serveFile(entry, req, res, abort.signal);
  }
  if (kind === "u") {
    const child = children.get(id);
    const entry = child ? registry.get(child.owner) : undefined;
    if (!child || !entry) return void res.writeHead(404).end();
    // Another playlist (a variant of the master) or a segment.
    if (/\.m3u8$/i.test(new URL(child.url).pathname)) return servePlaylist(entry, child.url, child.owner, res, abort.signal);
    return serveSegment(entry, child.url, req, res, abort.signal);
  }
  res.writeHead(404).end();
}

/** Total size of a seekable file, learned once with a 1-byte ranged read. */
async function totalSize(entry: Entry, signal: AbortSignal): Promise<number | null> {
  if (entry.totalBytes != null) return entry.totalBytes;
  const res = await upstream(entry.source.url, { ...entry.source.headers, Range: "bytes=0-0" }, entry.source.proxy, signal, [200, 206]);
  res.resume();
  const range = /\/(\d+)\s*$/.exec(String(res.headers["content-range"] ?? ""));
  const total = range ? Number(range[1]) : res.statusCode === 200 && res.headers["content-length"] ? Number(res.headers["content-length"]) : null;
  entry.totalBytes = total;
  return total;
}

function parseRange(header: string | undefined, total: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    return { start: Math.max(0, total - suffix), end: total - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
  return start <= end && start < total ? { start, end } : null;
}

async function serveFile(entry: Entry, req: IncomingMessage, res: ServerResponse, signal: AbortSignal): Promise<void> {
  const total = await totalSize(entry, signal);
  if (total == null) throw new UpstreamError(502, "size unknown");

  const requested = parseRange(req.headers.range, total);
  if (req.headers.range && !requested) return void res.writeHead(416, { "Content-Range": `bytes */${total}` }).end();
  const { start, end } = requested ?? { start: 0, end: total - 1 };

  res.writeHead(requested ? 206 : 200, {
    "Accept-Ranges": "bytes",
    "Content-Type": "application/octet-stream",
    "Content-Length": String(end - start + 1),
    ...(requested ? { "Content-Range": `bytes ${start}-${end}/${total}` } : {}),
  });
  if (req.method === "HEAD") return void res.end();

  let interruptions = 0;
  for (let pos = start; pos <= end && !signal.aborted; ) {
    const chunkEnd = Math.min(pos + CHUNK_BYTES - 1, end);
    let received = 0;
    try {
      const up = await upstream(entry.source.url, { ...entry.source.headers, Range: `bytes=${pos}-${chunkEnd}` }, entry.source.proxy, signal, [206, 200]);
      // A server that ignores Range and sends the whole file would corrupt every read past the start.
      if (up.statusCode === 200 && pos > 0) {
        up.destroy();
        throw new UpstreamError(400, "upstream ignored the byte range");
      }
      for await (const piece of up as AsyncIterable<Buffer>) {
        received += piece.length;
        entry.bytes += piece.length;
        if (!res.write(piece)) await once(res, "drain");
      }
    } catch (err) {
      // A connection that drops part-way through a chunk picks up again from the byte it reached,
      // rather than failing the clip; a refusal (4xx) or the client going away is final.
      const final = signal.aborted || (err instanceof UpstreamError && err.status < 500 && err.status !== 429);
      if (final || ++interruptions > MAX_TRIES) throw err;
      pos += received;
      continue;
    }
    if (received === 0) throw new UpstreamError(502, "upstream sent an empty chunk");
    pos += received;
  }
  res.end();
}

async function servePlaylist(entry: Entry, playlistUrl: string, owner: string, res: ServerResponse, signal: AbortSignal): Promise<void> {
  const up = await upstream(playlistUrl, entry.source.headers, entry.source.proxy, signal, [200]);
  const chunks: Buffer[] = [];
  for await (const piece of up as AsyncIterable<Buffer>) chunks.push(piece);
  const text = Buffer.concat(chunks).toString("utf8");
  entry.bytes += Buffer.byteLength(text);

  const { port } = await getServer();
  const localFor = (address: string): string => {
    const absolute = new URL(address, playlistUrl);
    const token = randomBytes(12).toString("hex");
    children.set(token, { url: absolute.toString(), owner });
    entry.children.add(token);
    // Keeps the file extension: ffmpeg's HLS reader decides what it will open from it.
    const ext = /\.[a-z0-9]{2,5}$/i.exec(absolute.pathname)?.[0] ?? ".ts";
    return `http://127.0.0.1:${port}/u/${token}${ext}`;
  };
  const rewritten = text
    .split(/\r?\n/)
    .map((line) => {
      if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="${localFor(uri)}"`);
      return line.trim() === "" ? line : localFor(line.trim());
    })
    .join("\n");

  res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Content-Length": String(Buffer.byteLength(rewritten)) });
  res.end(rewritten);
}

async function serveSegment(entry: Entry, url: string, req: IncomingMessage, res: ServerResponse, signal: AbortSignal): Promise<void> {
  const headers = { ...entry.source.headers, ...(req.headers.range ? { Range: String(req.headers.range) } : {}) };
  const up = await upstream(url, headers, entry.source.proxy, signal, [200, 206]);
  const pass: Record<string, string> = {};
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = up.headers[name];
    if (typeof value === "string") pass[name] = value;
  }
  res.writeHead(up.statusCode ?? 200, pass);
  for await (const piece of up as AsyncIterable<Buffer>) {
    entry.bytes += piece.length;
    if (!res.write(piece)) await once(res, "drain");
  }
  res.end();
}

/**
 * Makes a stream readable by ffmpeg through this machine. The returned address is plain HTTP to
 * localhost, so ffmpeg needs no HTTPS, certificates, DNS, proxy or headers of its own.
 */
export async function registerStream(source: RelaySource): Promise<RegisteredStream> {
  const { port } = await getServer();
  const id = randomBytes(12).toString("hex");
  const entry: Entry = { source, bytes: 0, totalBytes: null, children: new Set() };
  registry.set(id, entry);
  return {
    url: source.hls ? `http://127.0.0.1:${port}/h/${id}.m3u8` : `http://127.0.0.1:${port}/s/${id}.mp4`,
    bytesFetched: () => entry.bytes,
    dispose: () => {
      registry.delete(id);
      for (const token of entry.children) children.delete(token);
    },
  };
}
