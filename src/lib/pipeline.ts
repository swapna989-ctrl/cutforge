export type PipelineStatus = "idle" | "ingesting" | "queued" | "synthesizing" | "ready" | "failed";
export type Ratio = "9:16" | "16:9" | "1:1";
// Mirrors CAPTION_PRESETS in worker/src/ffmpeg.ts, which is what actually renders each style.
export type CaptionStyle = "classic" | "bold_yellow" | "rose";
// Mirrors CaptionLanguage in worker/src/transcribe.ts, which is what actually applies it.
export type CaptionLanguage = "auto" | "hinglish";
// Mirrors CLIP_LENGTH_BOUNDS in worker/src/clipPlanner.ts, which is what actually enforces it —
// "auto" is 30-90s (this project's real, deliberate default), "short" 15-30s, "long" 30-60s.
export type ClipLength = "auto" | "short" | "long";
