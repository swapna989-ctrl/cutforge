import type { BillingCycle, PlanTier } from "@/lib/pricing";

// The browser half of Razorpay checkout; the server half is src/app/api/razorpay/*. Nothing here
// decides what anything costs or grants anything: the order route prices it from pricing.ts, and
// credits/plans only ever land once the server has verified Razorpay's signature.

export type CheckoutRequest =
  | { kind: "credit_pack"; packCredits: number }
  | { kind: "subscription"; tier: Exclude<PlanTier, "none">; cycle: BillingCycle };

type RazorpaySuccess = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };

declare global {
  interface Window {
    Razorpay?: new (options: {
      key: string;
      amount: number;
      currency: string;
      order_id: string;
      name: string;
      description?: string;
      prefill?: { email?: string };
      theme?: { color: string };
      handler: (response: RazorpaySuccess) => void;
      modal?: { ondismiss?: () => void };
    }) => { open: () => void };
  }
}

const VERIFY_FAILED =
  "We couldn't confirm your payment yet. If you were charged, your plan or credits will appear within a few minutes — contact support if they don't.";

/**
 * Creates the order server-side, opens Razorpay's payment window, and on success posts the result
 * back for signature verification. If the tab closes before that round trip finishes, the webhook
 * (src/app/api/razorpay/webhook) grants the same payment, so a stalled `onSuccess` here is not
 * the only way credits ever land.
 */
export async function startCheckout(
  request: CheckoutRequest,
  handlers: {
    /** Shown in Razorpay's window, e.g. "Creator plan (monthly)". */
    description: string;
    email?: string;
    onSuccess: () => void;
    onError: (message: string) => void;
    /** The user closed the payment window without paying. */
    onDismiss: () => void;
  }
): Promise<void> {
  const { description, email, onSuccess, onError, onDismiss } = handlers;
  try {
    const createRes = await fetch("/api/razorpay/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const created = await createRes.json().catch(() => null);
    if (!createRes.ok || !created) {
      onError(created?.error ?? "Could not start checkout — please try again.");
      return;
    }
    const { orderId, amount, currency, keyId } = created as { orderId: string; amount: number; currency: string; keyId: string };

    if (!window.Razorpay) {
      onError("The payment window didn't load — check your connection and try again.");
      return;
    }

    const rzp = new window.Razorpay({
      key: keyId,
      amount,
      currency,
      order_id: orderId,
      name: "Flovura",
      description,
      prefill: email ? { email } : undefined,
      theme: { color: "#ed8395" },
      modal: { ondismiss: onDismiss },
      handler: async (response) => {
        try {
          const verifyRes = await fetch("/api/razorpay/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(response),
          });
          if (!verifyRes.ok) {
            onError(VERIFY_FAILED);
            return;
          }
          onSuccess();
        } catch {
          onError(VERIFY_FAILED);
        }
      },
    });
    rzp.open();
  } catch {
    onError("Could not start checkout — please try again.");
  }
}
