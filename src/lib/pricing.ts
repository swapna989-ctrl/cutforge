// The one place tier numbers live — mirrors plan_tier_config in
// supabase/migrations/0008_tiered_billing.sql, as last set by 0029_credits_per_minute.sql (the DB is
// what actually enforces credits/rollover; this is just so the UI can display the same numbers
// without hardcoding them a second time). Change a monthlyCredits or rolloverCap value here and it
// needs a new migration updating plan_tier_config to match.
//
// Deliberately in credits only: the pricing pages never say how many hours or minutes of video a plan
// or pack covers (people work that out from what a video costs). CREDITS_PER_MINUTE below is what
// links the two, and it is used to price a job, never to print a length on a pricing page.
export type PlanTier = "none" | "starter" | "creator" | "agency";
export type BillingCycle = "monthly" | "yearly";

export const TIER_LABEL: Record<PlanTier, string> = {
  none: "No active plan",
  starter: "Starter",
  creator: "Creator",
  agency: "Agency",
};

export const TIER_CONFIG: Record<Exclude<PlanTier, "none">, {
  monthlyCredits: number;
  rolloverCap: number;
  priceMonthly: number;
  priceYearlyPerMonth: number;
  priceYearlyTotal: number;
}> = {
  starter: { monthlyCredits: 1500, rolloverCap: 0, priceMonthly: 499, priceYearlyPerMonth: 349, priceYearlyTotal: 4188 },
  creator: { monthlyCredits: 6750, rolloverCap: 13500, priceMonthly: 1299, priceYearlyPerMonth: 909, priceYearlyTotal: 10908 },
  agency: { monthlyCredits: 18000, rolloverCap: 36000, priceMonthly: 2999, priceYearlyPerMonth: 2099, priceYearlyTotal: 25188 },
};

export const TIER_ORDER: Exclude<PlanTier, "none">[] = ["starter", "creator", "agency"];

// Beta-launch pricing: 30% off a monthly plan's first payment only, all three tiers -- never
// yearly (that's already its own, separate discounted rate), and never a later renewal (checked
// server-side in create-order/route.ts against whether this user has ever had a payment marked
// 'paid', not just trusted from the client). Set to 0 to end the promotion without touching
// anything else -- callers all route through discountedMonthlyPrice, so nothing needs updating
// beyond this one number.
export const BETA_LAUNCH_DISCOUNT_PERCENT = 30;

/** A tier's monthly price after the first-payment beta discount, rounded to the nearest rupee. */
export function discountedMonthlyPrice(tier: Exclude<PlanTier, "none">): number {
  return Math.round(TIER_CONFIG[tier].priceMonthly * (1 - BETA_LAUNCH_DISCOUNT_PERCENT / 100));
}

export const TIER_BLURB: Record<Exclude<PlanTier, "none">, string> = {
  starter: "For getting your first clips out the door.",
  creator: "For creators publishing shorts every week.",
  agency: "For teams clipping at volume across clients.",
};

/** "4.5x" / "~2.7x" — how many times bigger one tier's monthly allowance is than another's. Derived
 *  from TIER_CONFIG so the feature bullets below can't drift from the real credit counts. */
function allowanceRatio(bigger: Exclude<PlanTier, "none">, smaller: Exclude<PlanTier, "none">): string {
  const ratio = TIER_CONFIG[bigger].monthlyCredits / TIER_CONFIG[smaller].monthlyCredits;
  const tenths = Math.round(ratio * 10);
  const exact = Math.abs(ratio * 10 - tenths) < 1e-9;
  return `${exact ? "" : "~"}${tenths / 10}x`;
}

// Real features only — no priority processing, per-clip editing, automations, API/MCP access,
// team seats, or social scheduling, since none of those exist in Flovura yet. Shared by the
// public landing page and the in-app pricing page so the two can never list different things.
export const TIER_FEATURES: Record<Exclude<PlanTier, "none">, string[]> = {
  starter: ["AI clip planning + viral score", "Kinetic auto-captions", "Vertical & horizontal crop", "No watermark"],
  creator: ["Everything in Starter", `${allowanceRatio("creator", "starter")} Starter's monthly credits`, "Rollover up to 2x unused credits"],
  agency: ["Everything in Creator", `${allowanceRatio("agency", "creator")} Creator's monthly credits`, "Rollover up to 2x unused credits"],
};

// A video burns this many credits for every started minute of its length (a 100-minute video is 1,500
// credits) — mirrors charge_project_credits() in supabase/migrations/0029_credits_per_minute.sql, and
// CREDITS_PER_MINUTE in worker/src/credits.ts. The DB is what actually charges; this is only for
// showing a real estimate before submitting, since the worker measures the true duration and charges
// from that, not from anything the client computes.
export const CREDITS_PER_MINUTE = 15;

export function creditsForDuration(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60)) * CREDITS_PER_MINUTE;
}

/** A credit amount for display, grouped the Indian way: 1,500 / 18,000 / 1,00,000. */
export function formatCredits(n: number): string {
  return n.toLocaleString("en-IN");
}

// What re-generating one already-made clip costs — mirrors charge_short_regenerate_credit() in the same
// migration. A flat price (about a minute of video), not scaled by length, since clips are short.
export const REGENERATE_CREDITS = 15;

// What a new account starts with — mirrors the default on billing.free_credits (same migration).
export const FREE_SIGNUP_CREDITS = 150;

/** One-time credit packs, a top-up for people who are already subscribed. Each pack costs a little less
 *  per credit than the one before it (about 0.33, 0.31 and 0.29 rupees), and all of them cost more per
 *  credit than Creator or Agency, so upgrading stays the better deal for anyone using a lot. The in-app
 *  pricing page and checkout read this list so the numbers can't differ; see canBuyCreditPacks for
 *  who's allowed to see and buy them. */
export const CREDIT_PACKS: { credits: number; price: number; badge?: string }[] = [
  { credits: 600, price: 199 },
  { credits: 1600, price: 499 },
  { credits: 4500, price: 1299, badge: "Best value per credit" },
];

/** Packs are only sold to someone on an active paid plan (any tier, monthly or yearly), never to a
 *  free-tier account, so they top up a subscription instead of replacing it. Every place that shows
 *  or sells a pack has to go through this, and so does the code that grants one: the database
 *  refuses it too (buy_credit_pack, supabase/migrations/0026_credit_packs_require_plan.sql). */
export function canBuyCreditPacks(planTier: PlanTier): boolean {
  return planTier !== "none";
}

/** What to tell someone who's out of credits: a free-tier user is only ever pointed at plans,
 *  since packs aren't sold to them. Reads as the end of a sentence, e.g. "…— subscribe to a plan." */
export function getMoreCreditsHint(planTier: PlanTier): string {
  return canBuyCreditPacks(planTier) ? "add a credit pack or upgrade your plan" : "subscribe to a plan";
}
