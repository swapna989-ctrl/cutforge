export type PipelineStatus = "idle" | "ingesting" | "synthesizing" | "ready";
export type Ratio = "9:16" | "16:9";

export const SYNTH_STEPS: { at: number; msg: string }[] = [
  { at: 0, msg: "Detecting scene boundaries…" },
  { at: 14, msg: "Removing dead air & filler pauses…" },
  { at: 30, msg: "Syncing cuts to 124 BPM beat grid…" },
  { at: 46, msg: "Balancing color — Cinematic Warm…" },
  { at: 62, msg: "Auto-framing subject for output canvas…" },
  { at: 76, msg: "Generating captions…" },
  { at: 90, msg: "Rendering preview…" },
  { at: 100, msg: "Master ready." },
];

export const TOTAL_SHOTS = 24;
