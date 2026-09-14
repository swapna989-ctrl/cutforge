"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import type { PlanTier, BillingCycle } from "@/lib/pricing";

export type { PlanTier, BillingCycle };

type BillingData = {
  freeCredits: number;
  paidCredits: number;
  planTier: PlanTier;
  billingCycle: BillingCycle;
  planCredits: number;
  planRenewsAt: string | null;
};

const DEFAULT_DATA: BillingData = {
  freeCredits: 0,
  paidCredits: 0,
  planTier: "none",
  billingCycle: "monthly",
  planCredits: 0,
  planRenewsAt: null,
};

type BillingRow = {
  free_credits: number;
  paid_credits: number;
  plan_tier: string;
  billing_cycle: string;
  plan_credits: number;
  plan_renews_at: string | null;
};

function mapRow(row: BillingRow): BillingData {
  return {
    freeCredits: row.free_credits,
    paidCredits: row.paid_credits,
    planTier: row.plan_tier as PlanTier,
    billingCycle: row.billing_cycle as BillingCycle,
    planCredits: row.plan_credits,
    planRenewsAt: row.plan_renews_at,
  };
}

type BillingContextValue = {
  freeCredits: number;
  paidCredits: number;
  planTier: PlanTier;
  billingCycle: BillingCycle;
  planCredits: number;
  planRenewsAt: string | null;
  ready: boolean;
  hasActivePlan: boolean;
  /** True when the next export won't carry the CutForge watermark. */
  isWatermarkFree: boolean;
  /** True when there's any credit or plan allowance left to export with (watermarked or not). */
  canExport: boolean;
  /**
   * Call once per video submitted for clipping (see ClippingPage) — not per short downloaded.
   * A submission's watermark-free status is locked in at the same moment (see projects.watermark),
   * so charging here covers the whole batch of up to 5 AI-planned shorts that submission produces.
   * Enforced server-side (a Postgres function, not a plain table update) — the client can't just
   * set its own balance, and this can genuinely fail (e.g. a race with another tab draining the
   * last credit), so callers must handle the returned error rather than assume it always succeeds.
   * Spends this month's plan allowance first, then paid credits, then free credits.
   */
  consumeExportCredit: () => Promise<{ error: string | null }>;
  buyCreditPack: (amount: number) => Promise<{ error: string | null }>;
  subscribe: (tier: Exclude<PlanTier, "none">, cycle: BillingCycle) => Promise<{ error: string | null }>;
  cancelPlan: () => Promise<{ error: string | null }>;
};

const BillingContext = createContext<BillingContextValue | null>(null);

export function BillingProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady } = useAuth();
  const [state, setState] = useState<{ data: BillingData; ready: boolean }>({ data: DEFAULT_DATA, ready: false });

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to auth resolving to "signed out", an external system
      setState({ data: DEFAULT_DATA, ready: true });
      return;
    }

    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("billing")
      .select("free_credits, paid_credits, plan_tier, billing_cycle, plan_credits, plan_renews_at")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          // Shouldn't normally happen — a billing row is created by a database trigger the
          // moment a user signs up — but degrade to a visible zero-state rather than hang.
          if (error) console.error("Failed to load billing:", error.message);
          setState({ data: DEFAULT_DATA, ready: true });
          return;
        }
        setState({ data: mapRow(data as BillingRow), ready: true });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on user.id, not user object identity, so token refreshes don't re-fetch
  }, [authReady, user?.id]);

  const { data } = state;
  const hasActivePlan = data.planTier !== "none";
  const isWatermarkFree = hasActivePlan || data.paidCredits > 0;
  const canExport = (hasActivePlan && data.planCredits > 0) || data.paidCredits > 0 || data.freeCredits > 0;

  async function callBillingRpc(fn: string, args?: Record<string, unknown>): Promise<{ error: string | null }> {
    const supabase = createClient();
    const { data: row, error } = await supabase.rpc(fn, args);
    if (error) return { error: error.message };
    setState((prev) => ({ ...prev, data: mapRow(row as BillingRow) }));
    return { error: null };
  }

  function consumeExportCredit() {
    return callBillingRpc("consume_export_credit");
  }

  function buyCreditPack(amount: number) {
    return callBillingRpc("buy_credit_pack", { amount });
  }

  function subscribe(tier: Exclude<PlanTier, "none">, cycle: BillingCycle) {
    return callBillingRpc("set_subscription_tier", { new_tier: tier, new_cycle: cycle });
  }

  function cancelPlan() {
    return callBillingRpc("set_subscription_tier", { new_tier: "none" });
  }

  return (
    <BillingContext.Provider
      value={{
        freeCredits: data.freeCredits,
        paidCredits: data.paidCredits,
        planTier: data.planTier,
        billingCycle: data.billingCycle,
        planCredits: data.planCredits,
        planRenewsAt: data.planRenewsAt,
        ready: state.ready,
        hasActivePlan,
        isWatermarkFree,
        canExport,
        consumeExportCredit,
        buyCreditPack,
        subscribe,
        cancelPlan,
      }}
    >
      {children}
    </BillingContext.Provider>
  );
}

export function useBilling() {
  const ctx = useContext(BillingContext);
  if (!ctx) throw new Error("useBilling must be used within BillingProvider");
  return ctx;
}
