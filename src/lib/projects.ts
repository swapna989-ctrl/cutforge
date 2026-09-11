import type { PipelineStatus, Ratio } from "@/lib/pipeline";

export type Project = {
  id: string;
  name: string;
  ratio: Ratio;
  status: "ready" | "draft";
  pipelineStatus: PipelineStatus;
  progress: number;
  createdAt: string;
  duration: string;
};

export const MOCK_PROJECTS: Project[] = [
  { id: "p1", name: "product-launch-teaser.mp4", ratio: "9:16", status: "ready", pipelineStatus: "ready", progress: 100, createdAt: "2026-09-08", duration: "0:38" },
  { id: "p2", name: "founder-interview-raw.mov", ratio: "16:9", status: "ready", pipelineStatus: "ready", progress: 100, createdAt: "2026-09-06", duration: "4:12" },
  { id: "p3", name: "campus-tour-b-roll.mp4", ratio: "16:9", status: "draft", pipelineStatus: "synthesizing", progress: 42, createdAt: "2026-09-05", duration: "2:47" },
  { id: "p4", name: "reel-behind-the-scenes.mp4", ratio: "9:16", status: "ready", pipelineStatus: "ready", progress: 100, createdAt: "2026-09-02", duration: "0:52" },
];

export function getProject(id: string | null): Project | undefined {
  if (!id) return undefined;
  return MOCK_PROJECTS.find((p) => p.id === id);
}
