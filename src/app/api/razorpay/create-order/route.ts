import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { TIER_CONFIG, CREDIT_PACKS, type PlanTier, type BillingCycle } from "@/lib/pricing";

const razorpay = new Razorpay({ key_id: env("RAZORPAY_KEY_ID"), key_secret: env("RAZORPAY_KEY_SECRET") });

type CreateOrderBody =
  | { kind: "credit_pack"; packCredits: number }
  | { kind: "subscription"; tier: Exclude<PlanTier, "none">; cycle: BillingCycle };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as CreateOrderBody | null;
  if (!body || (body.kind !== "credit_pack" && body.kind !== "subscription")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // The price is always looked up here from pricing.ts, server-side — a request body can claim
  // any amount it wants, but only a real, listed price is ever actually charged or recorded.
  let amountRupees: number;
  let insertFields: { kind: string; tier: string | null; billing_cycle: string | null; credit_amount: number | null };

  if (body.kind === "credit_pack") {
    const pack = CREDIT_PACKS.find((p) => p.credits === body.packCredits);
    if (!pack) return NextResponse.json({ error: "Unknown credit pack" }, { status: 400 });
    amountRupees = pack.price;
    insertFields = { kind: "credit_pack", tier: null, billing_cycle: null, credit_amount: pack.credits };
  } else {
    const cfg = TIER_CONFIG[body.tier];
    if (!cfg || (body.cycle !== "monthly" && body.cycle !== "yearly")) {
      return NextResponse.json({ error: "Invalid tier or cycle" }, { status: 400 });
    }
    // Yearly bills the real one-time total up front (this is a manual re-charge model, not real
    // recurring billing) — priceYearlyPerMonth is only ever the *displayed* per-month rate.
    amountRupees = body.cycle === "monthly" ? cfg.priceMonthly : cfg.priceYearlyTotal;
    insertFields = { kind: "subscription", tier: body.tier, billing_cycle: body.cycle, credit_amount: null };
  }

  const amountPaise = Math.round(amountRupees * 100);

  let order: { id: string };
  try {
    order = await razorpay.orders.create({ amount: amountPaise, currency: "INR", receipt: `${user.id}-${Date.now()}` });
  } catch (err) {
    console.error("[razorpay] order creation failed:", err);
    return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
  }

  const { error: insertError } = await supabaseAdmin.from("payments").insert({
    user_id: user.id,
    razorpay_order_id: order.id,
    amount_paise: amountPaise,
    ...insertFields,
  });
  if (insertError) {
    console.error("[razorpay] failed to record payment row:", insertError.message);
    return NextResponse.json({ error: "Could not record order" }, { status: 500 });
  }

  return NextResponse.json({ orderId: order.id, amount: amountPaise, currency: "INR", keyId: env("NEXT_PUBLIC_RAZORPAY_KEY_ID") });
}
