"use client";

import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import WorkspaceView from "@/components/WorkspaceView";
import { useRequireAuth } from "@/lib/auth";
import { getProject } from "@/lib/projects";

export default function WorkspaceRoute() {
  const { ready, user } = useRequireAuth();
  const searchParams = useSearchParams();
  const project = getProject(searchParams.get("load"));

  if (!ready || !user) return null;

  return (
    <AppShell>
      <WorkspaceView initialProject={project} />
    </AppShell>
  );
}
