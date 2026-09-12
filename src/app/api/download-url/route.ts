import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDownloadUrl } from "@/lib/r2";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  // RLS (select_own_projects) already scopes this to the caller's own row — no extra
  // ownership check needed here.
  const { data: project, error } = await supabase.from("projects").select("output_key, name").eq("id", projectId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!project?.output_key) return NextResponse.json({ error: "No finished master for this project yet" }, { status: 404 });

  // Base the download's filename on the project name (what the user actually recognizes it by)
  // rather than the R2 key, which is just a UUID.
  const baseName = (project.name || "cutforge-master").replace(/\.[^./\\]+$/, "");
  const filename = `${baseName}-cutforge.mp4`;

  const downloadUrl = await getDownloadUrl(project.output_key, filename);
  return NextResponse.json({ downloadUrl });
}
