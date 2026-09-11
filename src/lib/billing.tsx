"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Plan = "none" | "weekly" | "monthly" | "yearly";

type BillingData = {
  freeCredits: number;
  paidCredits: number;
  plan: Plan;
};

const STORAGE_KEY = "cutforge_billing";
const FREE_TRIAL_CREDITS = 5;
const DEFAULT_DATA: BillingData = { freeCredits: FREE_TRIAL_CREDITS, paidCredits: 0, plan: "none" };

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
  /** Call once per completed export — spends a paid credit before a free (watermarked) one; no-op while a plan is active. */
  consumeExportCredit: () => void;
  buyCreditPack: (amount: number) => void;
  subscribe: (plan: Plan) => void;
  cancelPlan: () => void;
};

const BillingContext = createContext<BillingContextValue | null>(null);

export function BillingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ data: BillingData; ready: boolean }>({ data: DEFAULT_DATA, ready: false });

  useEffect(() => {
    // Deferred to an effect (not a lazy useState initializer) so the first client render
    // matches the server-rendered markup before we read browser-only localStorage.
    let data = DEFAULT_DATA;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) data = { ...DEFAULT_DATA, ...(JSON.parse(raw) as Partial<BillingData>) };
    } catch {
      // keep defaults
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see src/lib/auth.tsx for rationale
    setState({ data, ready: true });
  }, []);

  function update(fn: (d: BillingData) => BillingData) {
    setState((prev) => {
      const next = fn(prev.data);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { data: next, ready: true };
    });
  }

  const { data } = state;
  const hasActivePlan = data.plan !== "none";
  const isWatermarkFree = hasActivePlan || data.paidCredits > 0;
  const canExport = hasActivePlan || data.paidCredits > 0 || data.freeCredits > 0;

  function consumeExportCredit() {
    update((d) => {
      if (d.plan !== "none") return d;
      if (d.paidCredits > 0) return { ...d, paidCredits: d.paidCredits - 1 };
      if (d.freeCredits > 0) return { ...d, freeCredits: d.freeCredits - 1 };
      return d;
    });
  }

  function buyCreditPack(amount: number) {
    update((d) => ({ ...d, paidCredits: d.paidCredits + amount }));
  }

  function subscribe(plan: Plan) {
    update((d) => ({ ...d, plan }));
  }

  function cancelPlan() {
    update((d) => ({ ...d, plan: "none" }));
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
