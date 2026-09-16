import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// set_subscription_tier is service_role-only (see supabase/migrations/0012-0015) since it's also
// how paid credits get granted — cancellation needs the same trusted-server path, just for the
// caller's own account. No payment involved, so this only ever targets the signed-in user's own
// id, never one from the request body.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { error } = await supabaseAdmin.rpc("set_subscription_tier", {
    p_user_id: user.id,
    new_tier: "none",
    new_cycle: "monthly",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
