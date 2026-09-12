export type PipelineStatus = "idle" | "ingesting" | "queued" | "synthesizing" | "ready" | "failed";
export type Ratio = "9:16" | "16:9";

// Purely decorative flavor for the synthesis card's footer — real progress drives it, but the
// "24 shots" framing itself isn't a literal count of anything the worker tracks.
export const TOTAL_SHOTS = 24;
