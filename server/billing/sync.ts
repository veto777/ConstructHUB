/**
 * The `subscriptions` row as Stripe says it is. The webhook, change-plan,
 * add-ons and the daily Agency location sync all write the row through
 * subscriptionRowUpdate(), so the plan, interval and add-on quantities stored
 * here are read from the subscription's items (./prices describeSubscription)
 * — never from anything the client sent.
 */
import type Stripe from "stripe";
import { pool } from "../db";
import type { subscriptions } from "@shared/schema";
import { PLANS, LEGACY_PLAN_MAP, isPlanKey, effectivePlanKey } from "@shared/plans";
import { describeSubscription } from "./prices";
import { ensureBillingSchema } from "./schema";

type SubscriptionRow = typeof subscriptions.$inferSelect;
type SubscriptionSet = Partial<typeof subscriptions.$inferInsert>;

let schemaReady: Promise<void> | null = null;
/**
 * Adds the billing columns once per process (boot calls it from
 * registerStripeRoutes; billing routes await it). A failure is logged and
 * retried on the next call rather than failing the caller here — the query
 * that needs the columns reports its own error.
 */
export function billingSchemaReady(): Promise<void> {
  schemaReady ??= Promise.resolve()
    .then(() => ensureBillingSchema(pool))
    .catch((e: any) => {
      console.error("[billing] could not add the subscriptions billing columns:", e?.message || e);
      schemaReady = null;
    });
  return schemaReady;
}

// current_period_end moved from the Subscription object to
// items.data[].current_period_end in the Stripe 2025 (basil) API. Webhook
// payloads render at the endpoint's configured version — not the client's
// pinned version — so read the item field first and fall back to the legacy
// top-level field. Returns null rather than an Invalid Date when neither exists.
export function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const anySub = sub as any;
  const epoch: number | undefined =
    anySub.items?.data?.[0]?.current_period_end ?? anySub.current_period_end;
  return typeof epoch === "number" && Number.isFinite(epoch)
    ? new Date(epoch * 1000)
    : null;
}

/** Stripe statuses that still bill (or will): a user in one of these must change plans, not check out again. */
export const LIVE_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

export function hasLiveStripeSubscription(row: Pick<SubscriptionRow, "stripeSubscriptionId" | "status"> | null | undefined): boolean {
  return Boolean(row?.stripeSubscriptionId && LIVE_STATUSES.has(row.status));
}

/** One trial per account: only a customer who never had a Stripe subscription gets it. */
export const trialEligible = (row: Pick<SubscriptionRow, "stripeSubscriptionId"> | null | undefined) => !row?.stripeSubscriptionId;

/**
 * Whether a subscription event may write this row. The row tracks ONE
 * subscription; an event for a different one (e.g. a second subscription left
 * over from the old double-billing upgrade) must not overwrite it — unless the
 * tracked one is already over.
 */
export function eventAppliesToRow(row: Pick<SubscriptionRow, "stripeSubscriptionId" | "status">, subscriptionId: string): boolean {
  return !row.stripeSubscriptionId || row.stripeSubscriptionId === subscriptionId || !LIVE_STATUSES.has(row.status);
}

/**
 * Columns to write for a Stripe subscription. A subscription on a legacy price
 * (no role metadata) keeps its stored plan unless `fallbackPlan` — our own
 * checkout metadata — names a known one.
 */
export function subscriptionRowUpdate(sub: Stripe.Subscription, fallbackPlan?: string | null): SubscriptionSet {
  const shape = describeSubscription(sub.items?.data ?? []);
  const set: SubscriptionSet = {
    stripeSubscriptionId: sub.id,
    status: sub.status,
    currentPeriodEnd: subscriptionPeriodEnd(sub),
    billingInterval: shape.interval,
  };
  if (shape.plan && shape.planItem) {
    set.plan = shape.plan;
    set.stripePriceId = shape.planItem.price.id;
    set.addons = shape.addons as Record<string, number>;
    set.agencyLocations = shape.plan === "agency" ? PLANS.agency.limits.locations + shape.agencyExtraLocations : null;
  } else {
    if (fallbackPlan && (isPlanKey(fallbackPlan) || fallbackPlan in LEGACY_PLAN_MAP)) set.plan = fallbackPlan;
    set.stripePriceId = sub.items?.data?.[0]?.price?.id ?? null;
  }
  return set;
}

/** Columns for a row whose tracked subscription ended. */
export const canceledRowUpdate = (): SubscriptionSet => ({
  status: "canceled", plan: "free", addons: {}, agencyLocations: null, billingInterval: null,
});

/** What GET /api/stripe/subscription (and the change routes) report. */
export function subscriptionSummary(row: Partial<SubscriptionRow> | null | undefined) {
  if (!row) return { plan: "free", effectivePlan: null, status: "inactive", billingInterval: null, addons: {}, agencyLocations: null, currentPeriodEnd: null, stripeSubscriptionId: null };
  return {
    plan: row.plan ?? "free",
    effectivePlan: effectivePlanKey({ plan: row.plan, status: row.status }),
    status: row.status ?? "inactive",
    billingInterval: row.billingInterval ?? null,
    addons: row.addons ?? {},
    agencyLocations: row.agencyLocations ?? null,
    currentPeriodEnd: row.currentPeriodEnd ?? null,
    stripeSubscriptionId: row.stripeSubscriptionId ?? null,
  };
}
