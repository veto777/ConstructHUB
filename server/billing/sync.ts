/**
 * The `subscriptions` row as Stripe says it is. The webhook, change-plan,
 * add-ons and the daily Agency location sync all write the row through
 * subscriptionRowUpdate(), so the plan, interval and add-on quantities stored
 * here are read from the subscription's items (./prices describeSubscription)
 * — never from anything the client sent. Whether the subscription is set to
 * end (recordCancellation) is written beside them, and withBillingLock keeps
 * one account's billing changes from running at the same time.
 */
import { BillingRequestError } from "./order";
import type Stripe from "stripe";
import { pool } from "../db";
import type { subscriptions } from "@shared/schema";
import { PLANS, LEGACY_PLAN_MAP, ACCESS_STATUSES, isPlanKey } from "@shared/plans";
import { activePlanKey, grantExpired } from "../entitlements";
import { describeSubscription } from "./prices";
import { ensureBillingSchema } from "./schema";

type SubscriptionRow = typeof subscriptions.$inferSelect;
type SubscriptionSet = Partial<typeof subscriptions.$inferInsert>;

let schemaReady: Promise<void> | null = null;
/**
 * Adds the billing columns once per process (boot calls it from
 * registerStripeRoutes; billing routes await it). A failure is logged and
 * retried on the next call rather than failing the caller here — the query
 * that needs the columns reports its own error. The account pricing terms
 * (./pricing-terms.ts) are NOT in here on purpose: their cutover must fail
 * boot when it fails, so server/index.ts awaits ensurePricingTerms itself.
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
 * tracked one is already over. A row with no Stripe subscription may be a live
 * trial-code grant: only a live subscription replaces it, never a late event
 * for one that already ended.
 */
export function eventAppliesToRow(
  row: Pick<SubscriptionRow, "stripeSubscriptionId" | "status" | "plan" | "currentPeriodEnd">,
  sub: { id: string; status: string },
  now = new Date(),
): boolean {
  if (row.stripeSubscriptionId) return row.stripeSubscriptionId === sub.id || !LIVE_STATUSES.has(row.status);
  const liveGrant = !!activePlanKey({ plan: row.plan, status: row.status, stripe_subscription_id: null, current_period_end: row.currentPeriodEnd }, now);
  return !liveGrant || LIVE_STATUSES.has(sub.status);
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

/**
 * Whether (and when) a Stripe subscription is set to end. Stripe's portal may
 * record a cancellation either as cancel_at_period_end or as a cancel_at date;
 * a cancel_at on or before the period end is "ends at period end" too.
 */
export type Cancellation = { cancelAtPeriodEnd: boolean | null; cancelAt: Date | null; /** When the Stripe subscription began (its start_date); null until synced. */ startDate?: Date | null };

/** The subscription's start, as Stripe records it (`start_date`); null when the object carries none. */
export function subscriptionStartOf(sub: Stripe.Subscription): Date | null {
  const epoch = (sub as any).start_date ?? (sub as any).created;
  return typeof epoch === "number" && Number.isFinite(epoch) ? new Date(epoch * 1000) : null;
}

export function cancellationOf(sub: Stripe.Subscription): Cancellation {
  const epoch = (sub as any).cancel_at;
  const cancelAt = typeof epoch === "number" && Number.isFinite(epoch) ? new Date(epoch * 1000) : null;
  const periodEnd = subscriptionPeriodEnd(sub);
  const atPeriodEnd = sub.cancel_at_period_end === true
    || (!!cancelAt && !!periodEnd && cancelAt.getTime() <= periodEnd.getTime());
  return { cancelAtPeriodEnd: atPeriodEnd, cancelAt: cancelAt ?? (atPeriodEnd ? periodEnd : null) };
}

/**
 * Store a subscription's cancellation state beside the drizzle columns
 * (cancel_at_period_end / cancel_at are plain-SQL columns, see ./schema).
 * `sub` null = the tracked subscription ended: nothing left to cancel.
 */
export async function recordCancellation(where: { id: number } | { userId: number }, sub: Stripe.Subscription | null): Promise<void> {
  await billingSchemaReady();
  const c: Cancellation = sub ? cancellationOf(sub) : { cancelAtPeriodEnd: null, cancelAt: null };
  const [column, value] = "id" in where ? ["id", where.id] : ["user_id", where.userId];
  // The start date is written from the live subscription and kept when the subscription ended (sub null).
  await pool.query(
    `UPDATE subscriptions SET cancel_at_period_end = $2, cancel_at = $3, start_date = COALESCE($4, start_date) WHERE ${column} = $1`,
    [value, c.cancelAtPeriodEnd, c.cancelAt, sub ? subscriptionStartOf(sub) : null]);
}

/** The stored cancellation state (and start date) of a row (null = never synced from Stripe). */
export async function cancellationFor(rowId: number): Promise<Cancellation> {
  await billingSchemaReady();
  const { rows: [r] } = await pool.query("SELECT cancel_at_period_end, cancel_at, start_date FROM subscriptions WHERE id = $1", [rowId]);
  return {
    cancelAtPeriodEnd: typeof r?.cancel_at_period_end === "boolean" ? r.cancel_at_period_end : null,
    cancelAt: r?.cancel_at ? new Date(r.cancel_at) : null,
    startDate: r?.start_date ? new Date(r.start_date) : null,
  };
}

/**
 * What GET /api/stripe/subscription (and the change routes) report.
 * `interval` and `locations` repeat `billingInterval` and `agencyLocations`
 * under the names the pricing/Settings client reads. Without them a yearly
 * subscriber's plan or location change is sent as monthly.
 *
 * A Stripe-less grant (trial code) whose end date has passed reports
 * status "inactive" and no effective plan — the same rule getEntitlements
 * applies, so the page never shows an expired trial as a live one.
 * `cancelAtPeriodEnd` is only known for Stripe subscriptions (null otherwise,
 * or while a row has not been synced since the column was added).
 */
export function subscriptionSummary(row: Partial<SubscriptionRow> | null | undefined, cancellation: Cancellation | null = null, now = new Date()) {
  if (!row) return { plan: "free", effectivePlan: null, status: "inactive", billingInterval: null, interval: null, addons: {}, agencyLocations: null, locations: null, currentPeriodEnd: null, stripeSubscriptionId: null, cancelAtPeriodEnd: null, cancelAt: null, startDate: null };
  const snake = { plan: row.plan, status: row.status, stripe_subscription_id: row.stripeSubscriptionId, current_period_end: row.currentPeriodEnd };
  const viaStripe = !!row.stripeSubscriptionId;
  // A grant still marked trialing/active past its end date has simply run out.
  const ranOut = grantExpired(snake, now) && ACCESS_STATUSES.includes(row.status ?? "");
  return {
    plan: row.plan ?? "free",
    effectivePlan: activePlanKey(snake, now),
    status: ranOut ? "inactive" : row.status ?? "inactive",
    billingInterval: row.billingInterval ?? null,
    interval: row.billingInterval ?? null,
    addons: row.addons ?? {},
    agencyLocations: row.agencyLocations ?? null,
    locations: row.agencyLocations ?? null,
    currentPeriodEnd: row.currentPeriodEnd ?? null,
    stripeSubscriptionId: row.stripeSubscriptionId ?? null,
    cancelAtPeriodEnd: viaStripe ? cancellation?.cancelAtPeriodEnd ?? null : null,
    cancelAt: viaStripe ? cancellation?.cancelAt ?? null : null,
    // When the Stripe subscription began (its start_date, stored by recordCancellation); null until synced or for a grant.
    startDate: viaStripe ? cancellation?.startDate ?? null : null,
  };
}

const billingQueues = new Map<number, Promise<void>>();
/**
 * Runs one account's billing changes one at a time (create-checkout,
 * change-plan, add-ons): two requests at the same moment — a double click, two
 * tabs — can't both find "no open checkout" and each start one, or both
 * reprice the same subscription items. Per process; the app runs as one
 * process (constructhub.service), and Stripe-side checks in the routes cover
 * what a lock can't (a subscription the webhook hasn't reported yet).
 */
export const BILLING_QUEUE_WAIT_MS = 30_000;
export async function withBillingLock<T>(userId: number, fn: () => Promise<T>, waitMs = BILLING_QUEUE_WAIT_MS): Promise<T> {
  const prior = billingQueues.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  const tail = prior.then(() => mine);
  billingQueues.set(userId, tail);
  // The wait for the turn is bounded: a request stuck behind a slow one is told "busy, try again"
  // (503) rather than left hanging; its own turn is then released at once so the next waiter moves.
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BillingRequestError(503, "Billing is busy with another change to this account. Try again in a moment.", "billing_busy")), waitMs);
    timer.unref?.();
  });
  try {
    await Promise.race([prior, timedOut]);
  } catch (e) {
    clearTimeout(timer);
    // Our place in the queue is given up without running: the waiter behind us follows the one before us.
    prior.then(release, release);
    throw e;
  }
  clearTimeout(timer);
  try {
    return await fn();
  } finally {
    release();
    if (billingQueues.get(userId) === tail) billingQueues.delete(userId);
  }
}
