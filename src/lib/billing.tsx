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

async function fetchBillingRow(userId: string): Promise<BillingData> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("billing")
    .select("free_credits, paid_credits, plan_tier, billing_cycle, plan_credits, plan_renews_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) {
    // Shouldn't normally happen — a billing row is created by a database trigger the moment a
    // user signs up — but degrade to a visible zero-state rather than hang.
    if (error) console.error("Failed to load billing:", error.message);
    return DEFAULT_DATA;
  }
  return mapRow(data as BillingRow);
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
  /** True when the next export won't carry the Flovura watermark. */
  isWatermarkFree: boolean;
  /** True when there's any credit or plan allowance left to export with (watermarked or not). */
  canExport: boolean;
  /** Total credits actually spendable right now (active plan's remaining allowance + paid + free). */
  availableCredits: number;
  /**
   * Spends an exact number of credits for the legacy single-output "Download Master" flow (see
   * WorkspaceView) — the only remaining client-initiated charge. Every new (post-AI-Clip-Planner)
   * submission is charged server-side by the worker once it knows the real video duration (see
   * charge_project_credits in supabase/migrations/0009_duration_scaled_credits.sql), not by this.
   * Enforced server-side (a Postgres function, not a plain table update) — the client can't just
   * set its own balance, and this can genuinely fail (e.g. a race with another tab draining the
   * last credit), so callers must handle the returned error rather than assume it always succeeds.
   * Spends this month's plan allowance first, then paid credits, then free credits.
   */
  consumeExportCredit: (creditsNeeded: number) => Promise<{ error: string | null }>;
  /** Re-fetches the real balance from the DB — see the note on refresh() below for why this exists. */
  refresh: () => Promise<void>;
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
    fetchBillingRow(user.id).then((data) => {
      if (!cancelled) setState({ data, ready: true });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on user.id, not user object identity, so token refreshes don't re-fetch
  }, [authReady, user?.id]);

  const { data } = state;
  const hasActivePlan = data.planTier !== "none";
  const isWatermarkFree = hasActivePlan || data.paidCredits > 0;
  const availableCredits = (hasActivePlan ? data.planCredits : 0) + data.paidCredits + data.freeCredits;
  const canExport = (hasActivePlan && data.planCredits > 0) || data.paidCredits > 0 || data.freeCredits > 0;

  // Charging for a new submission now happens server-side, in the worker, once it knows the
  // video's real duration (see charge_project_credits in
  // supabase/migrations/0009_duration_scaled_credits.sql) — the client never deducts anything at
  // submission time, so its local balance can't be kept in sync by watching RPC responses. This
  // is the fallback: re-fetch the real row from the DB on demand (e.g. while a submission's
  // pipeline is in progress, see ClippingPage's polling effect).
  async function refresh() {
    if (!user) return;
    const data = await fetchBillingRow(user.id);
    setState({ data, ready: true });
  }

  async function callBillingRpc(fn: string, args?: Record<string, unknown>): Promise<{ error: string | null }> {
    const supabase = createClient();
    const { data: row, error } = await supabase.rpc(fn, args);
    if (error) return { error: error.message };
    setState((prev) => ({ ...prev, data: mapRow(row as BillingRow) }));
    return { error: null };
  }

  function consumeExportCredit(creditsNeeded: number) {
    return callBillingRpc("consume_export_credit", { credits_needed: creditsNeeded });
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
        availableCredits,
        consumeExportCredit,
        refresh,
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
