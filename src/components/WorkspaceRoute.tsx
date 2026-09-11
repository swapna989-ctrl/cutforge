"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import WorkspaceView from "@/components/WorkspaceView";
import { useRequireAuth } from "@/lib/auth";
import { getProject, type Project } from "@/lib/projects";

export default function WorkspaceRoute() {
  const { ready, user } = useRequireAuth();
  const searchParams = useSearchParams();
  const loadId = searchParams.get("load");

  const [project, setProject] = useState<Project | null>(null);
  // No `load` param means a brand-new project — nothing to fetch, skip straight to "loaded".
  const [projectLoadState, setProjectLoadState] = useState<"loading" | "loaded">(loadId ? "loading" : "loaded");

  useEffect(() => {
    if (!loadId || !ready || !user) return;
    let cancelled = false;
    // Redundant on first run (already initialized to "loading"), but resets it correctly if
    // loadId changes to a different project without a full remount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProjectLoadState("loading");
    getProject(loadId)
      .then((p) => {
        if (cancelled) return;
        setProject(p);
        setProjectLoadState("loaded");
      })
      .catch(() => {
        // Falls back to a fresh workspace rather than blocking — a missing/denied project
        // shouldn't strand the user.
        if (cancelled) return;
        setProject(null);
        setProjectLoadState("loaded");
      });
    return () => {
      cancelled = true;
    };
  }, [loadId, ready, user]);

  if (!ready || !user || projectLoadState === "loading") return null;

  return (
    <AppShell>
      <WorkspaceView initialProject={project ?? undefined} />
    </AppShell>
  );
}
