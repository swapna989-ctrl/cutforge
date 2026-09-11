"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";

export type Plan = "none" | "weekly" | "monthly" | "yearly";

type BillingData = {
  freeCredits: number;
  paidCredits: number;
  plan: Plan;
};

const STORAGE_PREFIX = "cutforge_billing:";
const FREE_TRIAL_CREDITS = 5;
const DEFAULT_DATA: BillingData = { freeCredits: FREE_TRIAL_CREDITS, paidCredits: 0, plan: "none" };
const VALID_PLANS: Plan[] = ["none", "weekly", "monthly", "yearly"];

function sanitize(raw: unknown): BillingData {
  if (!raw || typeof raw !== "object") return DEFAULT_DATA;
  const r = raw as Partial<Record<keyof BillingData, unknown>>;
  return {
    freeCredits: typeof r.freeCredits === "number" && r.freeCredits >= 0 ? r.freeCredits : DEFAULT_DATA.freeCredits,
    paidCredits: typeof r.paidCredits === "number" && r.paidCredits >= 0 ? r.paidCredits : DEFAULT_DATA.paidCredits,
    plan: typeof r.plan === "string" && VALID_PLANS.includes(r.plan as Plan) ? (r.plan as Plan) : DEFAULT_DATA.plan,
  };
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
  /** Call once per completed export — spends a paid credit before a free (watermarked) one; no-op while a plan is active. */
  consumeExportCredit: () => void;
  buyCreditPack: (amount: number) => void;
  subscribe: (plan: Plan) => void;
  cancelPlan: () => void;
};

const BillingContext = createContext<BillingContextValue | null>(null);

export function BillingProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady } = useAuth();
  const [state, setState] = useState<{ data: BillingData; ready: boolean; userId: string | null }>({
    data: DEFAULT_DATA,
    ready: false,
    userId: null,
  });

  useEffect(() => {
    // Waits for auth to resolve, then loads (or resets) billing state scoped to that specific
    // user's id — otherwise two different accounts on the same browser would share one balance.
    if (!authReady) return;
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to auth resolving to "signed out", an external system
      setState({ data: DEFAULT_DATA, ready: true, userId: null });
      return;
    }
    let data = DEFAULT_DATA;
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + user.id);
      if (raw) data = sanitize(JSON.parse(raw));
    } catch {
      // keep defaults
    }
    setState({ data, ready: true, userId: user.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on user.id, not user object identity, so token refreshes don't re-trigger a reload
  }, [authReady, user?.id]);

  function update(fn: (d: BillingData) => BillingData) {
    setState((prev) => {
      if (!prev.userId) return prev;
      const next = fn(prev.data);
      window.localStorage.setItem(STORAGE_PREFIX + prev.userId, JSON.stringify(next));
      return { ...prev, data: next };
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
