import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyHmacSignature } from "@/lib/razorpay";
import { env } from "@/lib/env";

type RazorpayWebhookPayload = {
  event: string;
  payload?: { payment?: { entity?: { id?: string; order_id?: string } } };
};

// The reliability safety net for /api/razorpay/verify: Razorpay calls this directly from its own
// servers whenever a payment event happens, independent of whether the paying user's browser tab
// is even still open. No session auth here — the signature below is the only trust boundary, so
// the raw body must be read before any JSON parsing (parsing first would let whitespace
// differences silently break the signature check).
export async function POST(request: Request) {
  if (!env("RAZORPAY_WEBHOOK_SECRET")) {
    console.error("[razorpay webhook] RAZORPAY_WEBHOOK_SECRET is not set; refusing every delivery");
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  if (!signature || !verifyHmacSignature(rawBody, env("RAZORPAY_WEBHOOK_SECRET"), signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
  if (payload.event === "payment.captured") {
    const payment = payload.payload?.payment?.entity;
    if (payment?.order_id && payment?.id) {
      const { error } = await getSupabaseAdmin().rpc("process_razorpay_payment", {
        p_order_id: payment.order_id,
        p_razorpay_payment_id: payment.id,
      });
      if (error) {
        console.error("[razorpay webhook] process_razorpay_payment failed:", error.message);
        // An order we never created (another product on the same Razorpay account) can't ever be
        // processed, so acknowledge it; anything else is a real failure, and answering with an error
        // makes Razorpay redeliver the event instead of the payment silently never being granted.
        if (!error.message.includes("No payment record")) {
          return NextResponse.json({ error: "Could not process payment" }, { status: 500 });
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
