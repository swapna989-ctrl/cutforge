"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

export type Plan = "none" | "weekly" | "monthly" | "yearly";

type BillingData = {
  freeCredits: number;
  paidCredits: number;
  plan: Plan;
};

const DEFAULT_DATA: BillingData = { freeCredits: 0, paidCredits: 0, plan: "none" };

type BillingRow = { free_credits: number; paid_credits: number; plan: string };

function mapRow(row: BillingRow): BillingData {
  return { freeCredits: row.free_credits, paidCredits: row.paid_credits, plan: row.plan as Plan };
}

type BillingContextValue = {
  freeCredits: number;
  paidCredits: number;
  plan: Plan;
  ready: boolean;
  hasActivePlan: boolean;
  /** True when the next export won't carry the CutForge watermark. */
  isWatermarkFree: boolean;
  /** True when there's any credit or plan left to export with (watermarked or not). */
  canExport: boolean;
  /**
   * Call once per completed export. This is enforced server-side (a Postgres function, not a
   * plain table update) — the client can't just set its own balance, and this can genuinely
   * fail (e.g. a race with another tab draining the last credit), so callers must handle the
   * returned error rather than assume it always succeeds.
   */
  consumeExportCredit: () => Promise<{ error: string | null }>;
  buyCreditPack: (amount: number) => Promise<{ error: string | null }>;
  subscribe: (plan: Plan) => Promise<{ error: string | null }>;
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
      .select("free_credits, paid_credits, plan")
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
  const hasActivePlan = data.plan !== "none";
  const isWatermarkFree = hasActivePlan || data.paidCredits > 0;
  const canExport = hasActivePlan || data.paidCredits > 0 || data.freeCredits > 0;

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

  function subscribe(plan: Plan) {
    return callBillingRpc("set_subscription_plan", { new_plan: plan });
  }

  function cancelPlan() {
    return callBillingRpc("set_subscription_plan", { new_plan: "none" });
  }

  return (
    <BillingContext.Provider
      value={{
        freeCredits: data.freeCredits,
        paidCredits: data.paidCredits,
        plan: data.plan,
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
