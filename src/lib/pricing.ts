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
