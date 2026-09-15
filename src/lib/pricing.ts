// The one place tier numbers live — mirrors plan_tier_config in
// supabase/migrations/0008_tiered_billing.sql (the DB is what actually enforces credits/rollover;
// this is just so the UI can display the same numbers without hardcoding them a second time).
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
  starter: { monthlyCredits: 15, rolloverCap: 0, priceMonthly: 499, priceYearlyPerMonth: 349, priceYearlyTotal: 4188 },
  creator: { monthlyCredits: 45, rolloverCap: 90, priceMonthly: 1299, priceYearlyPerMonth: 909, priceYearlyTotal: 10908 },
  agency: { monthlyCredits: 120, rolloverCap: 240, priceMonthly: 2999, priceYearlyPerMonth: 2099, priceYearlyTotal: 25188 },
};

export const TIER_ORDER: Exclude<PlanTier, "none">[] = ["starter", "creator", "agency"];

export const TIER_BLURB: Record<Exclude<PlanTier, "none">, string> = {
  starter: "For getting your first clips out the door.",
  creator: "For creators publishing shorts every week.",
  agency: "For teams clipping at volume across clients.",
};

// Real features only — no priority processing, per-clip editing, automations, API/MCP access,
// team seats, or social scheduling, since none of those exist in CutForge yet. Shared by the
// public landing page and the in-app pricing page so the two can never list different things.
export const TIER_FEATURES: Record<Exclude<PlanTier, "none">, string[]> = {
  starter: ["AI clip planning + viral score", "Kinetic auto-captions", "Vertical & horizontal crop", "No watermark"],
  creator: ["Everything in Starter", "3x Starter's monthly minutes", "Rollover up to 2x unused credits"],
  agency: ["Everything in Creator", "~2.7x Creator's monthly minutes", "Rollover up to 2x unused credits"],
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
