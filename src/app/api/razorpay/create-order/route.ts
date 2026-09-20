import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import Razorpay from "razorpay";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { TIER_CONFIG, TIER_ORDER, CREDIT_PACKS, canBuyCreditPacks, type PlanTier, type BillingCycle } from "@/lib/pricing";

type CreateOrderBody =
  | { kind: "credit_pack"; packCredits: number }
  | { kind: "subscription"; tier: Exclude<PlanTier, "none">; cycle: BillingCycle };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });

  const keyId = env("RAZORPAY_KEY_ID");
  const keySecret = env("RAZORPAY_KEY_SECRET");
  const publicKeyId = env("NEXT_PUBLIC_RAZORPAY_KEY_ID");
  // The service-role key is checked here too, before an order exists: recording the payment needs it,
  // and finding it missing afterwards would leave an order at Razorpay that nothing records.
  if (!keyId || !keySecret || !publicKeyId || !env("SUPABASE_SERVICE_ROLE_KEY")) {
    console.error(
      "[razorpay] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / NEXT_PUBLIC_RAZORPAY_KEY_ID / SUPABASE_SERVICE_ROLE_KEY are not all set"
    );
    return NextResponse.json({ error: "Payments aren't available right now — please try again later." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as CreateOrderBody | null;
  if (!body || (body.kind !== "credit_pack" && body.kind !== "subscription")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // The price is always looked up here from pricing.ts, server-side — a request body can claim
  // any amount it wants, but only a real, listed price is ever actually charged or recorded.
  let amountRupees: number;
  let description: string;
  let insertFields: { kind: string; tier: string | null; billing_cycle: string | null; credit_amount: number | null };

  if (body.kind === "credit_pack") {
    const pack = CREDIT_PACKS.find((p) => p.credits === body.packCredits);
    if (!pack) return NextResponse.json({ error: "Unknown credit pack" }, { status: 400 });

    // Packs are a top-up for people on an active plan; refuse before anyone is charged, since a
    // payment taken for something we then can't grant would have to be refunded by hand. (The
    // database refuses the grant as well: buy_credit_pack, migration 0028.)
    const { data: billing } = await supabase.from("billing").select("plan_tier").eq("user_id", user.id).maybeSingle();
    if (!billing || !canBuyCreditPacks(billing.plan_tier as PlanTier)) {
      return NextResponse.json({ error: "Credit packs are available on an active plan — pick a plan first." }, { status: 403 });
    }

    amountRupees = pack.price;
    description = `${pack.credits} credits`;
    insertFields = { kind: "credit_pack", tier: null, billing_cycle: null, credit_amount: pack.credits };
  } else {
    if (!TIER_ORDER.includes(body.tier) || (body.cycle !== "monthly" && body.cycle !== "yearly")) {
      return NextResponse.json({ error: "Invalid tier or cycle" }, { status: 400 });
    }
    const cfg = TIER_CONFIG[body.tier];
    // Yearly bills the real one-time total up front (this is a manual re-charge model, not real
    // recurring billing) — priceYearlyPerMonth is only ever the *displayed* per-month rate.
    amountRupees = body.cycle === "monthly" ? cfg.priceMonthly : cfg.priceYearlyTotal;
    description = `${body.tier} plan (${body.cycle})`;
    insertFields = { kind: "subscription", tier: body.tier, billing_cycle: body.cycle, credit_amount: null };
  }

  const amountPaise = Math.round(amountRupees * 100);

  let order: { id: string };
  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    order = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      // Razorpay caps a receipt at 40 characters, so a user id plus a timestamp doesn't fit.
      receipt: randomUUID().replace(/-/g, ""),
      notes: { user_id: user.id, description },
    });
  } catch (err) {
    console.error("[razorpay] order creation failed:", err);
    return NextResponse.json({ error: "Could not start checkout — please try again." }, { status: 502 });
  }

  const { error: insertError } = await getSupabaseAdmin().from("payments").insert({
    user_id: user.id,
    razorpay_order_id: order.id,
    amount_paise: amountPaise,
    ...insertFields,
  });
  if (insertError) {
    console.error("[razorpay] failed to record payment row:", insertError.message);
    return NextResponse.json({ error: "Could not start checkout — please try again." }, { status: 500 });
  }

  return NextResponse.json({ orderId: order.id, amount: amountPaise, currency: "INR", keyId: publicKeyId });
}
