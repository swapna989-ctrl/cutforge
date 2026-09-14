import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDownloadUrl } from "@/lib/r2";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const shortId = url.searchParams.get("shortId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  if (shortId) {
    // RLS (select_own_shorts, via a join to projects.user_id) already scopes this to the
    // caller's own row — no extra ownership check needed here.
    const { data: short, error } = await supabase
      .from("shorts")
      .select("output_key, hook, position")
      .eq("id", shortId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!short?.output_key) return NextResponse.json({ error: "This short isn't ready yet" }, { status: 404 });

    const baseName = (short.hook || `cutforge-short-${short.position + 1}`)
      .replace(/[/\\?%*:|"<>]/g, "")
      .trim()
      .slice(0, 60) || `cutforge-short-${short.position + 1}`;
    const filename = `${baseName}.mp4`;

    const downloadUrl = await getDownloadUrl(short.output_key, filename);
    return NextResponse.json({ downloadUrl });
  }

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
