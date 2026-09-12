import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getUploadUrl } from "@/lib/r2";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { fileName, contentType } = (await request.json()) as { fileName?: string; contentType?: string };
  if (!fileName || !contentType) {
    return NextResponse.json({ error: "fileName and contentType are required" }, { status: 400 });
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${user.id}/source/${randomUUID()}-${safeName}`;

  const uploadUrl = await getUploadUrl(key, contentType);
  return NextResponse.json({ uploadUrl, key });
}
