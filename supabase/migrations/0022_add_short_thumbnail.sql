-- Fixes gallery thumbnails not showing on mobile Safari/WebKit -- a <video> element with no
-- `poster` relies on the browser self-rendering a first frame from preload="metadata" alone,
-- which desktop browsers do but mobile Safari (and Chrome/other browsers on iOS, all WebKit
-- under the hood) reliably does NOT, confirmed by the user seeing real thumbnails on desktop and
-- blank/spinner-forever on phone for the exact same ready shorts.
--
-- worker/src/pipeline.ts and regenerate.ts now extract one real JPEG frame from each short's own
-- FINAL rendered output (captions/crop/watermark already applied) via worker/src/ffmpeg.ts's new
-- extractFrame, so the frontend can use it as a real <video poster> instead of depending on that
-- unreliable browser behavior. Non-fatal to generate -- a failed extraction just leaves this null.

alter table public.shorts add column thumbnail_key text;
