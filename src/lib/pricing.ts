// The one place tier numbers live — mirrors plan_tier_config in
// supabase/migrations/0008_tiered_billing.sql, as last set by 0025_starter_10_credits.sql (the DB is
// what actually enforces credits/rollover; this is just so the UI can display the same numbers
// without hardcoding them a second time). Change a monthlyCredits or rolloverCap value here and it
// needs a new migration updating plan_tier_config to match.
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
  starter: { monthlyCredits: 10, rolloverCap: 0, priceMonthly: 499, priceYearlyPerMonth: 349, priceYearlyTotal: 4188 },
  creator: { monthlyCredits: 45, rolloverCap: 90, priceMonthly: 1299, priceYearlyPerMonth: 909, priceYearlyTotal: 10908 },
  agency: { monthlyCredits: 120, rolloverCap: 240, priceMonthly: 2999, priceYearlyPerMonth: 2099, priceYearlyTotal: 25188 },
};

export const TIER_ORDER: Exclude<PlanTier, "none">[] = ["starter", "creator", "agency"];

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
  creator: ["Everything in Starter", `${allowanceRatio("creator", "starter")} Starter's monthly minutes`, "Rollover up to 2x unused credits"],
  agency: ["Everything in Creator", `${allowanceRatio("agency", "creator")} Creator's monthly minutes`, "Rollover up to 2x unused credits"],
};

// 1 credit = up to this many seconds of source video — mirrors charge_project_credits() in
// supabase/migrations/0009_duration_scaled_credits.sql (the DB is what actually charges; this is
// only for showing a real estimate before submitting, since the worker measures the true duration
// and charges from that, not from anything the client computes).
export const CREDIT_SECONDS = 600;

export function creditsForDuration(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / CREDIT_SECONDS));
}

/** Minutes of video a given number of credits actually buys — for display only. */
export function creditsToMinutes(credits: number): number {
  return (credits * CREDIT_SECONDS) / 60;
}

/** 150 -> "2.5 hrs", 45 -> "45 min" — whichever reads more naturally at that size. */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hrs`;
}

/** One-time credit packs, a premium top-up for people who are already subscribed. The in-app pricing
 *  page and checkout read this list so the numbers can't differ; see canBuyCreditPacks for who's
 *  allowed to see and buy them. */
export const CREDIT_PACKS: { credits: number; price: number; badge?: string }[] = [
  { credits: 10, price: 599 },
  { credits: 30, price: 1499 },
  { credits: 100, price: 3999, badge: "Best value per credit" },
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
