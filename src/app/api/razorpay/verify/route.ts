import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyHmacSignature } from "@/lib/razorpay";
import { env } from "@/lib/env";

type VerifyBody = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };

// The immediate, client-triggered confirmation path — fires right after Razorpay Checkout's own
// success callback, so credits usually appear instantly. The webhook route is the reliability
// fallback for when this never runs (tab closed mid-checkout); both call the same idempotent
// process_razorpay_payment, so whichever fires first does the real work.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Partial<VerifyBody> | null;
  if (!body?.razorpay_order_id || !body?.razorpay_payment_id || !body?.razorpay_signature) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const signedPayload = `${body.razorpay_order_id}|${body.razorpay_payment_id}`;
  if (!verifyHmacSignature(signedPayload, env("RAZORPAY_KEY_SECRET"), body.razorpay_signature)) {
    return NextResponse.json({ error: "We couldn't verify that payment." }, { status: 400 });
  }

  const { error } = await getSupabaseAdmin().rpc("process_razorpay_payment", {
    p_order_id: body.razorpay_order_id,
    p_razorpay_payment_id: body.razorpay_payment_id,
  });
  if (error) {
    console.error("[razorpay] process_razorpay_payment failed:", error.message);
    return NextResponse.json({ error: "Payment verified but could not be processed — contact support" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
