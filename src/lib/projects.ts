import type { PipelineStatus, Ratio } from "@/lib/pipeline";

type RawProject = {
  id: string;
  name: string;
  ratio: Ratio;
  pipelineStatus: PipelineStatus;
  progress: number;
  createdAt: string;
  duration: string;
};

export type Project = RawProject & { status: "ready" | "draft" };

const RAW_PROJECTS: RawProject[] = [
  { id: "p1", name: "product-launch-teaser.mp4", ratio: "9:16", pipelineStatus: "ready", progress: 100, createdAt: "2026-09-08", duration: "0:38" },
  { id: "p2", name: "founder-interview-raw.mov", ratio: "16:9", pipelineStatus: "ready", progress: 100, createdAt: "2026-09-06", duration: "4:12" },
  { id: "p3", name: "campus-tour-b-roll.mp4", ratio: "16:9", pipelineStatus: "synthesizing", progress: 42, createdAt: "2026-09-05", duration: "2:47" },
  { id: "p4", name: "reel-behind-the-scenes.mp4", ratio: "9:16", pipelineStatus: "ready", progress: 100, createdAt: "2026-09-02", duration: "0:52" },
];

// Derived, not hand-authored, so it can never disagree with pipelineStatus.
export const MOCK_PROJECTS: Project[] = RAW_PROJECTS.map((p) => ({
  ...p,
  status: p.pipelineStatus === "ready" ? "ready" : "draft",
}));

export function getProject(id: string | null): Project | undefined {
  if (!id) return undefined;
  return MOCK_PROJECTS.find((p) => p.id === id);
}
