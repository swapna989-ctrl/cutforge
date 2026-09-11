import { Suspense } from "react";
import WorkspaceRoute from "@/components/WorkspaceRoute";

export default function WorkspacePage() {
  return (
    <Suspense fallback={null}>
      <WorkspaceRoute />
    </Suspense>
  );
}
