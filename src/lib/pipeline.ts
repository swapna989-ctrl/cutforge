export type PipelineStatus = "idle" | "ingesting" | "queued" | "synthesizing" | "ready" | "failed";
export type Ratio = "9:16" | "16:9";
// Mirrors CAPTION_PRESETS in worker/src/ffmpeg.ts, which is what actually renders each style.
export type CaptionStyle = "classic" | "bold_yellow" | "rose";
// Mirrors CaptionLanguage in worker/src/transcribe.ts, which is what actually applies it.
export type CaptionLanguage = "auto" | "hinglish";
