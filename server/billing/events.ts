/**
 * In-process billing events — what the Stripe webhook saw, typed, for the
 * parts of the app that act on it (the billing emails, the in-app bell).
 *
 *   billingEvents.on("invoice.paid", async ({ userId, invoice }) => { ... });
 *   billingEvents.emit("invoice.paid", { userId, invoice, stripeInvoice });
 *
 * Every payload names the account (`userId`) and carries the ledger row the
 * webhook just wrote (server/billing/ledger.ts), so a listener never has to
 * read Stripe again. A listener that throws (or rejects) is logged and never
 * fails the webhook or the other listeners; `emit` resolves once every
 * listener settled, which the webhook does not wait for.
 *
 * Kinds (one per Stripe event the webhook handles):
 *   invoice.paid / invoice.payment_failed / invoice.finalized — the invoice row
 *   subscription.started       — a plan checkout completed (first subscription)
 *   subscription.trial_will_end — Stripe's 3-days-before-trial-end notice
 *   subscription.cancel_scheduled / subscription.cancel_resumed — set to end at
 *     the period end (billing portal), or that undone
 *   subscription.canceled      — the tracked subscription ended (plan is gone)
 *   purchase.completed         — a one-time checkout (course, service) was paid
 */
import type Stripe from "stripe";
import type { BillingInvoiceRow, BillingPurchaseRow } from "./ledger";
import { recordFailure } from "../ops/issues";

type InvoicePayload = {
  userId: number;
  invoice: BillingInvoiceRow;
  stripeInvoice: Stripe.Invoice;
};

type SubscriptionPayload = {
  userId: number;
  subscriptionId: string;
  /** shared/plans.ts key when the subscription is on a current price; otherwise the stored plan name or null. */
  plan: string | null;
  status: string;
};

export type BillingEventMap = {
  "invoice.paid": InvoicePayload;
  "invoice.payment_failed": InvoicePayload & {
    attemptCount: number;
    nextPaymentAttempt: Date | null;
  };
  "invoice.finalized": InvoicePayload;
  "subscription.started": SubscriptionPayload & {
    interval: "month" | "year" | null;
    trialEnd: Date | null;
    currentPeriodEnd: Date | null;
  };
  "subscription.trial_will_end": SubscriptionPayload & { trialEnd: Date | null };
  "subscription.cancel_scheduled": SubscriptionPayload & { cancelAt: Date | null };
  "subscription.cancel_resumed": SubscriptionPayload;
  "subscription.canceled": SubscriptionPayload;
  "purchase.completed": { userId: number; purchase: BillingPurchaseRow };
};

export type BillingEventKind = keyof BillingEventMap;
export type BillingListener<K extends BillingEventKind> = (payload: BillingEventMap[K]) => void | Promise<void>;

export class BillingEventBus {
  private listeners = new Map<BillingEventKind, Set<BillingListener<any>>>();

  /** Subscribe; returns the unsubscribe function. */
  on<K extends BillingEventKind>(kind: K, listener: BillingListener<K>): () => void {
    let set = this.listeners.get(kind);
    if (!set) this.listeners.set(kind, (set = new Set()));
    set.add(listener);
    return () => { set!.delete(listener); };
  }

  once<K extends BillingEventKind>(kind: K, listener: BillingListener<K>): () => void {
    const off = this.on(kind, (payload) => { off(); return listener(payload); });
    return off;
  }

  off<K extends BillingEventKind>(kind: K, listener: BillingListener<K>): void {
    this.listeners.get(kind)?.delete(listener);
  }

  listenerCount(kind: BillingEventKind): number {
    return this.listeners.get(kind)?.size ?? 0;
  }

  /**
   * Call every listener now (synchronously up to its first await). A throw or
   * rejection is logged with the event kind and never reaches the caller.
   * Resolves once all listeners settled — tests await it; the webhook doesn't.
   */
  emit<K extends BillingEventKind>(kind: K, payload: BillingEventMap[K]): Promise<void> {
    const set = this.listeners.get(kind);
    if (!set?.size) return Promise.resolve();
    const settled: Promise<unknown>[] = [];
    for (const listener of [...set]) {
      try {
        const result = listener(payload);
        if (result && typeof (result as Promise<void>).then === "function") {
          settled.push((result as Promise<void>).catch((e: any) => {
            console.error(`[billing-events] ${kind} listener failed:`, e?.message || e);
            void recordFailure("job", `Billing event listener (${kind})`, e);
          }));
        }
      } catch (e: any) {
        console.error(`[billing-events] ${kind} listener threw:`, e?.message || e);
        void recordFailure("job", `Billing event listener (${kind})`, e);
      }
    }
    return Promise.all(settled).then(() => undefined);
  }

  /** Tests only: drop every listener. */
  removeAllListeners(): void {
    this.listeners.clear();
  }
}

/** The app's one bus. Register listeners at boot (server/routes.ts), emit from the webhook. */
export const billingEvents = new BillingEventBus();
