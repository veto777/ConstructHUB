/**
 * What the Stripe webhook (server/stripe.ts) does with the billing events
 * beyond the subscription row: record the invoice / purchase in the ledger
 * and tell the rest of the app through billingEvents (./events).
 *
 * Each handler resolves the account first and does nothing — loudly — when
 * it can't: a row is never written for an account we can't name.
 */
import type Stripe from "stripe";
import { billingEvents } from "./events";
import { upsertInvoice, upsertPurchase, type BillingInvoiceRow, type BillingPurchaseRow } from "./ledger";
import {
  epochToDate, idOf, invoiceRowFromStripe, resolveInvoiceUserId, purchaseRowFromSession, userIdForCustomer,
} from "./invoices";
import { describeSubscription } from "./prices";
import { cancellationOf, subscriptionPeriodEnd, type Cancellation } from "./sync";

export type InvoiceEventType = "invoice.paid" | "invoice.payment_failed" | "invoice.finalized";
export const INVOICE_EVENT_TYPES: ReadonlySet<string> = new Set<InvoiceEventType>(["invoice.paid", "invoice.payment_failed", "invoice.finalized"]);

/** The plan a subscription's items say it is on; `fallback` (the stored plan) when it is on a legacy price. */
export function planOf(sub: Stripe.Subscription, fallback: string | null = null): string | null {
  try {
    return describeSubscription(sub.items?.data ?? []).plan ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * An event raised on a connected account (the CRM's client payments, which
 * have their own endpoint) carries `account`; the platform ledger is only
 * for the platform's own customers.
 */
export const isConnectEvent = (event: Stripe.Event): boolean => typeof event.account === "string" && event.account.length > 0;

const positiveInt = (raw: unknown): number | null => {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** invoice.paid / invoice.payment_failed / invoice.finalized → upsert the row, emit the same-named event. */
export async function syncInvoiceEvent(event: Stripe.Event): Promise<{ userId: number; invoice: BillingInvoiceRow; applied: boolean } | null> {
  if (!INVOICE_EVENT_TYPES.has(event.type) || isConnectEvent(event)) return null;
  const inv = event.data.object as Stripe.Invoice;
  const userId = await resolveInvoiceUserId(inv);
  if (!userId) {
    console.warn(`[billing] ${event.type} for ${inv.id}: no account for customer ${idOf(inv.customer) ?? "(none)"} — not recorded.`);
    return null;
  }
  const invoice = invoiceRowFromStripe(inv, userId);
  if (!(await upsertInvoice(invoice))) {
    // Delivered out of order: the ledger already holds this invoice as paid /
    // void, so this open snapshot is history. Nobody is told the invoice is
    // "due" or "failed" after it was paid.
    console.warn(`[billing] ${event.type} for ${inv.id} arrived after the invoice settled — ledger kept, no notice emitted.`);
    return { userId, invoice, applied: false };
  }
  if (event.type === "invoice.payment_failed") {
    void billingEvents.emit("invoice.payment_failed", {
      userId, invoice, stripeInvoice: inv,
      attemptCount: inv.attempt_count ?? 0,
      nextPaymentAttempt: epochToDate(inv.next_payment_attempt),
    });
  } else {
    void billingEvents.emit(event.type as "invoice.paid" | "invoice.finalized", { userId, invoice, stripeInvoice: inv });
  }
  return { userId, invoice, applied: true };
}

/** customer.subscription.trial_will_end → subscription.trial_will_end (3 days before the trial converts). */
export async function onTrialWillEnd(event: Stripe.Event, storedPlan: string | null = null): Promise<number | null> {
  if (isConnectEvent(event)) return null;
  const sub = event.data.object as Stripe.Subscription;
  const userId = (await userIdForCustomer(idOf(sub.customer))) ?? positiveInt(sub.metadata?.userId);
  if (!userId) {
    console.warn(`[billing] trial_will_end for ${sub.id}: no account for customer ${idOf(sub.customer) ?? "(none)"} — ignored.`);
    return null;
  }
  void billingEvents.emit("subscription.trial_will_end", {
    userId, subscriptionId: sub.id, plan: planOf(sub, storedPlan), status: sub.status, trialEnd: epochToDate(sub.trial_end),
  });
  return userId;
}

/** A paid one-time Checkout Session → billing_purchases row + purchase.completed. Null when it isn't one. */
export async function recordOneTimePurchase(session: Stripe.Checkout.Session, userId: number): Promise<BillingPurchaseRow | null> {
  const purchase = await purchaseRowFromSession(session, userId);
  if (!purchase) return null;
  await upsertPurchase(purchase);
  void billingEvents.emit("purchase.completed", { userId, purchase });
  return purchase;
}

/** A plan checkout completed: the account's subscription started (trial or paid). */
export function emitSubscriptionStarted(userId: number, sub: Stripe.Subscription, storedPlan: string | null = null): void {
  const shape = describeSubscription(sub.items?.data ?? []);
  void billingEvents.emit("subscription.started", {
    userId, subscriptionId: sub.id, plan: shape.plan ?? storedPlan, status: sub.status,
    interval: shape.interval ?? null, trialEnd: epochToDate(sub.trial_end), currentPeriodEnd: subscriptionPeriodEnd(sub),
  });
}

// The fields that say WHEN a subscription ends. cancellation_details (the
// customer's feedback/comment) is deliberately not one: Stripe can update it
// on its own, after the cancellation was already scheduled, and that must not
// read as "scheduled again" (a second "your plan will end" notice).
const CANCEL_KEYS = ["cancel_at_period_end", "cancel_at"] as const;

/**
 * customer.subscription.updated: did this event schedule the subscription to
 * end, or undo that? Decided from Stripe's previous_attributes when the event
 * carries them (the cancel fields changed in this very update), else from the
 * cancellation state we had stored before applying the event (null = never
 * synced → unknown → nothing emitted, rather than a stale "will end" email).
 */
export function cancellationChange(
  sub: Stripe.Subscription,
  previous: Record<string, unknown> | undefined,
  stored: Cancellation | null,
): "scheduled" | "resumed" | null {
  const now = cancellationOf(sub).cancelAtPeriodEnd === true;
  const changedInEvent = !!previous && CANCEL_KEYS.some((k) => k in previous);
  if (changedInEvent) {
    if (now) return "scheduled";
    const was = previous!.cancel_at_period_end === true || typeof previous!.cancel_at === "number";
    return was ? "resumed" : null;
  }
  if (typeof stored?.cancelAtPeriodEnd !== "boolean") return null;
  if (now && !stored.cancelAtPeriodEnd) return "scheduled";
  if (!now && stored.cancelAtPeriodEnd) return "resumed";
  return null;
}

export function emitCancellationChange(
  userId: number,
  sub: Stripe.Subscription,
  previous: Record<string, unknown> | undefined,
  stored: Cancellation | null,
  storedPlan: string | null = null,
): "scheduled" | "resumed" | null {
  const change = cancellationChange(sub, previous, stored);
  const base = { userId, subscriptionId: sub.id, plan: planOf(sub, storedPlan), status: sub.status };
  if (change === "scheduled") void billingEvents.emit("subscription.cancel_scheduled", { ...base, cancelAt: cancellationOf(sub).cancelAt });
  else if (change === "resumed") void billingEvents.emit("subscription.cancel_resumed", base);
  return change;
}

/** customer.subscription.deleted for the tracked subscription: the plan is over. */
export function emitSubscriptionCanceled(userId: number, sub: Stripe.Subscription, storedPlan: string | null = null): void {
  void billingEvents.emit("subscription.canceled", {
    userId, subscriptionId: sub.id, plan: planOf(sub, storedPlan), status: sub.status ?? "canceled",
  });
}
