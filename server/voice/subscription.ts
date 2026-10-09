/**
 * Selling the AI Call Assistant — its own Stripe subscription, apart from the
 * platform plan (owner, 2026-10-08: a separate service, bought with or without
 * a platform plan; the CRM's pattern, server/crm/billing.ts).
 *
 *   GET  /api/call-assistant/billing/plans         the price book (public)
 *   GET  /api/call-assistant/billing/subscription  this account's Call Assistant subscription
 *   POST /api/call-assistant/billing/checkout      start one (Stripe Checkout; no trial)
 *   POST /api/call-assistant/billing/change        change tier / interval / extra numbers in place
 *
 * One account, one Stripe customer, up to three subscriptions: the platform
 * plan (server/stripe.ts, table `subscriptions`), the CRM plan
 * (server/crm/billing.ts) and the Call Assistant (here, table
 * `call_assistant_subscriptions`, server/voice/subscription-store.ts). A Call
 * Assistant subscription is marked metadata.product = "call_assistant" and is
 * made only of the Call Assistant's own prices (one tier, plus the extra
 * number); the platform webhook hands every event for one to the handlers
 * below and never writes it to `subscriptions`.
 *
 * Prices are Stripe Prices found or created by lookup key from the cents
 * (server/billing/prices.ts addonPriceSpec): the 2026-10-08 prices made new
 * Prices on the first checkout, nothing by hand. No intro price: the launch
 * intro ended with the repricing, and server/billing/intro.ts is never called
 * from here (it stays for the grants it recorded).
 *
 * The owner's rules carry over unchanged: the assistant runs only while this
 * subscription is active or trialing (server/entitlements.ts
 * ADDON_MODULE_RUN_STATUSES — "as soon as they stop paying the agent stops
 * working"); when it ends, or a change pays for fewer numbers, the org's
 * numbers are released (server/voice/number-release.ts afterSubscriptionChange,
 * called after every write here and from the webhook); overage is billed on
 * this subscription (server/voice/billing-usage.ts), and every outstanding
 * minute is settled when the subscription ends — a settlement job written in
 * the same transaction as the end, run at once and by every sweep until done.
 *
 * One live Call Assistant subscription per account, also under a race (Codex
 * audits 2026-10-09). Every transition — the webhook's events, the checkout and
 * change routes — goes through syncCallAssistantSubscription: resolve the
 * account, take its database lock (server/billing/locks.ts withCallAssistantLock,
 * a Postgres advisory lock, so a webhook and a route, or two server processes,
 * take turns), THEN read the subscription as Stripe has it now and apply the
 * whole transition; a snapshot that waited behind a cancellation can never
 * restore access. The pattern everywhere: claim under the lock → the Stripe
 * call outside it → record the outcome under the lock, conditionally. A
 * checkout or tier change is an ATTEMPT ROW (call_assistant_checkout_attempts):
 * one in flight per account across processes (a partial unique index), taken
 * under the lock with its Stripe idempotency key before Stripe is asked,
 * completed only while it is still that attempt; a competing request resumes
 * the same session or is told to wait. A second live subscription the webhook
 * sees never replaces the tracked one: it gets its own row
 * (call_assistant_duplicate_cancellations), is cancelled at Stripe when it is
 * ours and completed by its own id; a cancellation that fails keeps its row
 * pending, is recorded as an ops issue and thrown, so the webhook fails and
 * Stripe retries it, and a boot/6-hourly job retries what is still pending
 * (retryDuplicateCancellations). An end is recorded in the same transaction
 * as its settlement job (server/voice/billing-usage.ts), which runs right away
 * and is retried by every sweep until done.
 *
 * Internal, never in copy: the service costs ConstructHUB about 20 cents a
 * minute (the SignalWire AI agent); every tier and the overage sit above it.
 */
import type Stripe from "stripe";
import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { stripe, stripeConfigured, stripeTimeoutMs } from "../billing/client";
import { withCallAssistantLock } from "../billing/locks";
import { BillingRequestError } from "../billing/order";
import { LIVE_STATUSES, subscriptionPeriodEnd, withBillingLock } from "../billing/sync";
import { addonPriceSpec, resolvePriceId, roleOfPrice, type PriceSpec } from "../billing/prices";
import { appReturnBaseUrl } from "../site-context";
import { getEntitlements } from "../entitlements";
import { forgetDashboard } from "../dashboard/cache";
import { recordFailure } from "../ops/issues";
import { afterSubscriptionChange } from "./number-release";
import { enqueueVoiceSettlement, runVoiceSettlementsForAccount, voiceOverageAdminStatus, voiceOverageBillingState } from "./billing-usage";
import {
  ADDONS, ADDON_MAX_QUANTITY, CALL_ASSISTANT_TIERS, CALL_ASSISTANT_NAME, CALL_ASSISTANT_FREE_SPAM_CALLS, CALL_ASSISTANT_ANNUAL_MONTHS,
  CALL_ASSISTANT_OVERAGE_CENTS_PER_MINUTE, CALL_ASSISTANT_PRICING_HREF, TALK_TO_SALES_CODE,
  callAssistantTier, callAssistantTierForAddon, callAssistantTierKey, callAssistantAddonsOf,
  type BillingInterval, type CallAssistantTier, type CallAssistantTierKey,
} from "@shared/plans";
import {
  callAssistantSchemaReady, callAssistantSubscriptionRow, type CallAssistantAttemptRow, type CallAssistantSubscriptionRow,
} from "./subscription-store";
import { isPlatformAdminEmail } from "../admin";

export const CALL_ASSISTANT_PRODUCT = "call_assistant";
export const CALL_ASSISTANT_CHECKOUT_TYPE = "call_assistant";

/**
 * A Stripe subscription that is the Call Assistant (ours to handle, never the
 * platform's): marked as the product, or made of a tier price with no plan
 * price beside it. A platform subscription always has a plan item, so one
 * that still carried a tier line from before the split stays the platform's.
 */
export function isCallAssistantSubscription(sub: Pick<Stripe.Subscription, "metadata" | "items"> | null | undefined): boolean {
  if (!sub) return false;
  if (sub.metadata?.product === CALL_ASSISTANT_PRODUCT) return true;
  const roles = (sub.items?.data ?? []).map((item) => roleOfPrice(item.price));
  const hasTier = roles.some((role) => role?.kind === "addon" && !!callAssistantTierForAddon(role.key));
  const hasPlan = roles.some((role) => role?.kind === "plan");
  return hasTier && !hasPlan;
}

export const isCallAssistantCheckoutSession = (session: Pick<Stripe.Checkout.Session, "metadata"> | null | undefined) =>
  session?.metadata?.type === CALL_ASSISTANT_CHECKOUT_TYPE;

export type CallAssistantOrder = { tier: CallAssistantTierKey; interval: BillingInterval; extraNumbers: number };

const tierList = () => CALL_ASSISTANT_TIERS.map((t) => t.name).join(", ");

/**
 * The order a request asks for: a tier (its key, or the add-on key the tier
 * picker sends), monthly or yearly, and extra numbers. `fallback` is the
 * current subscription on a change, so a body that names one thing leaves the
 * rest as it is. More extra numbers than ADDON_MAX_QUANTITY is a sales
 * conversation; more minutes than the top tier is one too, and is never a
 * tier here (the price book lists none).
 */
export function parseCallAssistantOrder(body: any, fallback?: Partial<CallAssistantOrder>): CallAssistantOrder {
  const raw = body?.tier ?? body?.addon ?? fallback?.tier;
  const tier = callAssistantTierKey(raw) ?? callAssistantTierForAddon(typeof raw === "string" ? raw : null)?.tier ?? null;
  if (!tier) {
    throw new BillingRequestError(400, `Choose a ${CALL_ASSISTANT_NAME} tier: ${tierList()}.`, "unknown_tier");
  }
  const rawInterval = body?.interval ?? fallback?.interval ?? "month";
  if (rawInterval !== "month" && rawInterval !== "year") {
    throw new BillingRequestError(400, "Billing is monthly or yearly.", "unknown_interval");
  }
  const rawNumbers = body?.extraNumbers ?? fallback?.extraNumbers ?? 0;
  if (typeof rawNumbers !== "number" || !Number.isInteger(rawNumbers) || rawNumbers < 0) {
    throw new BillingRequestError(400, "Extra numbers must be a whole number, 0 or more.", "bad_quantity");
  }
  if (rawNumbers > ADDON_MAX_QUANTITY) {
    throw new BillingRequestError(409, `For more than ${ADDON_MAX_QUANTITY} extra numbers, talk to a sales rep. Nothing was charged.`, TALK_TO_SALES_CODE);
  }
  return { tier, interval: rawInterval, extraNumbers: rawNumbers };
}

/** What a Call Assistant Stripe subscription says: the tier, the interval, the extra numbers and the items that carry them. */
export function describeCallAssistantSubscription(sub: Pick<Stripe.Subscription, "items">) {
  let tier: CallAssistantTier | null = null, interval: BillingInterval | null = null, extraNumbers = 0;
  let tierItem: Stripe.SubscriptionItem | null = null, numberItem: Stripe.SubscriptionItem | null = null;
  for (const item of sub.items?.data ?? []) {
    const role = roleOfPrice(item.price);
    if (role?.kind !== "addon") continue;
    const t = callAssistantTierForAddon(role.key);
    if (t && !tierItem) { tier = t; interval = role.interval; tierItem = item; }
    else if (role.key === "call_number" && !numberItem) { numberItem = item; extraNumbers = item.quantity ?? 0; }
  }
  if (!interval) {
    const first = (sub.items?.data ?? []).map((i) => i.price?.recurring?.interval).find((i) => i === "month" || i === "year");
    interval = (first as BillingInterval | undefined) ?? null;
  }
  return { tier, interval, extraNumbers, tierItem, numberItem };
}

const customerIdOf = (sub: Pick<Stripe.Subscription, "customer">): string | null =>
  typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

/** What the subscription writers reach outside the database; a test hands in doubles. */
export type SubscriptionWriteDeps = {
  /** The subscription as Stripe has it NOW, read under the account lock. Default: stripe.subscriptions.retrieve. */
  retrieve?: (subscriptionId: string) => Promise<Stripe.Subscription>;
  /** Run the account's persisted settlement jobs once an end is recorded. Default: runVoiceSettlementsForAccount. */
  settle?: (userId: number) => Promise<unknown>;
  /** Cancel a second live subscription of ours at Stripe. Default: stripe.subscriptions.cancel with the unused time credited. */
  cancelDuplicate?: (subscriptionId: string) => Promise<unknown>;
  /** A subscription's status at Stripe (the retry job asks before cancelling again). Default: stripe.subscriptions.retrieve. */
  retrieveStatus?: (subscriptionId: string) => Promise<string | null>;
  /** The account's lock (default: the database lock, withCallAssistantLock); a unit test with a mocked database hands in a pass-through. */
  lock?: <T>(userId: number, run: () => Promise<T>) => Promise<T>;
};
const lockFor = (deps: SubscriptionWriteDeps) => deps.lock ?? withCallAssistantLock;
const retrieveAtStripe = (subscriptionId: string) => stripe.subscriptions.retrieve(subscriptionId);
/** The default: cancel now, crediting the unused time to the customer's balance (never a refund by itself — that is the owner's call). */
const cancelDuplicateAtStripe = (subscriptionId: string) => stripe.subscriptions.cancel(subscriptionId, { prorate: true, invoice_now: true });
const retrieveStatusAtStripe = async (subscriptionId: string) => (await stripe.subscriptions.retrieve(subscriptionId)).status ?? null;

/** A few statements in one database transaction on a connection of their own (the lock's own connection only holds the lock). */
async function withTransaction<T>(run: (c: { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await run(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * A duplicate live subscription could not be cancelled at Stripe. Thrown out of
 * the webhook so the event fails and Stripe retries it; the row remembers the
 * duplicate (duplicate_retry_needed) for the retry job as well.
 */
export class DuplicateSubscriptionError extends Error {
  constructor(readonly userId: number, readonly duplicateId: string, readonly cause: unknown) {
    super(`Duplicate Call Assistant subscription ${duplicateId} for user ${userId} could not be cancelled: ${(cause as any)?.message ?? cause}`);
    this.name = "DuplicateSubscriptionError";
  }
}

/** The subscription an event or a route names: its id, and what helps find its account without a round trip. */
export type SubscriptionRef = Pick<Stripe.Subscription, "id"> & Partial<Pick<Stripe.Subscription, "customer" | "metadata">>;

/** The account a subscription belongs to: our metadata, then the row that tracks it, then the Stripe customer (on either table). */
async function resolveAccount(ref: SubscriptionRef, hintUserId?: number | null): Promise<number | null> {
  const customerId = ref.customer === undefined ? null : customerIdOf(ref as Pick<Stripe.Subscription, "customer">);
  let found = hintUserId || parseInt(ref.metadata?.userId || "0") || null;
  if (!found) {
    const { rows: [bySub] } = await pool.query(`SELECT user_id FROM call_assistant_subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`, [ref.id]);
    found = bySub?.user_id ?? null;
  }
  if (!found && customerId) {
    const { rows: [byCustomer] } = await pool.query(
      `SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1
       UNION SELECT user_id FROM call_assistant_subscriptions WHERE stripe_customer_id = $1 LIMIT 1`, [customerId]);
    found = byCustomer?.user_id ?? null;
  }
  return found ? Number(found) : null;
}

type TransitionOutcome = {
  /** A second live subscription beside the tracked one: ours to cancel (its row is pending), or only noted. */
  duplicate?: { id: string; ours: boolean };
  /** The tracked subscription ended: its settlement job is persisted and should run now. */
  settle: boolean;
};

/**
 * The whole transition for one subscription, under the account lock, from the
 * state Stripe reports NOW: the row tracks ONE subscription — another id while
 * the tracked one is live is a late event for an older one (ignored) or a
 * second live one (a duplicate: its own cancellation row, cancelled outside
 * the lock, completed by its own id); the tracked one ending has its settlement
 * job written in the SAME transaction as the end, so no end is recorded
 * without it; a live subscription recorded closes the account's checkout
 * attempt in the same transaction; everything else is the row taking the
 * subscription's tier, extras, status and period. Database work only.
 */
async function applyTransition(userId: number, sub: Stripe.Subscription, deps: SubscriptionWriteDeps): Promise<TransitionOutcome> {
  const customerId = customerIdOf(sub);
  const existing = await callAssistantSubscriptionRow(userId);
  const live = LIVE_STATUSES.has(sub.status);
  if (existing?.stripe_subscription_id && existing.stripe_subscription_id !== sub.id && LIVE_STATUSES.has(existing.status)) {
    if (!live) return { settle: false };
    const ours = sub.metadata?.product === CALL_ASSISTANT_PRODUCT && !!customerId && customerId === existing.stripe_customer_id;
    const facts = { userId, tracked: existing.stripe_subscription_id, duplicate: sub.id, customer: customerId, status: sub.status, ours };
    console.error(`[call-assistant-billing] DUPLICATE live Call Assistant subscription for user ${userId}: keeping ${existing.stripe_subscription_id}, ${ours ? "cancelling" : "NOT cancelling (not ours)"} ${sub.id}`, JSON.stringify(facts));
    // One row per duplicate, written BEFORE the cancel is attempted: a crash in between leaves it pending for the retry job.
    await pool.query(
      `INSERT INTO call_assistant_duplicate_cancellations (user_id, tracked_subscription_id, duplicate_subscription_id, ours, state)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (duplicate_subscription_id) DO NOTHING`,
      [userId, existing.stripe_subscription_id, sub.id, ours, ours ? "pending" : "skipped"]);
    if (!ours) void recordFailure("call_assistant", "Duplicate Call Assistant subscription check", new Error(`${sub.id} is live beside ${existing.stripe_subscription_id} and is not ours to cancel; check it in Stripe`), facts);
    return { duplicate: { id: sub.id, ours }, settle: false };
  }
  const shape = describeCallAssistantSubscription(sub);
  const ended = !live;
  // The tracked subscription ending (deleted, or an update that says canceled / incomplete_expired): its settlement
  // is persisted in the same transaction, whatever the row said before (a repeat with a job already open is a no-op).
  const ending = ended && existing?.stripe_subscription_id === sub.id;
  await withTransaction(async (c) => {
    if (ending) await enqueueVoiceSettlement(c, { accountUserId: userId, stripeSubscriptionId: sub.id, stripeCustomerId: existing?.stripe_customer_id ?? customerId, billingInterval: existing?.billing_interval ?? shape.interval });
    // A live subscription recorded is what the account's checkout attempt (if any) was for: closed with it. An
    // ended one voids every open attempt (a change of a subscription that is gone, a checkout now superseded), so
    // nothing left in flight can strand the account's next checkout.
    if (live) await c.query(`UPDATE call_assistant_checkout_attempts SET state = 'done', finished_at = now(), updated_at = now() WHERE user_id = $1 AND kind = 'checkout' AND state IN ('creating', 'open')`, [userId]);
    if (ending) await c.query(`UPDATE call_assistant_checkout_attempts SET state = 'expired', finished_at = now(), updated_at = now() WHERE user_id = $1 AND state IN ('creating', 'open')`, [userId]);
    await c.query(
      `INSERT INTO call_assistant_subscriptions
         (user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, tier, extra_numbers, status, billing_interval,
          current_period_end, cancel_at_period_end, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (user_id) DO UPDATE SET
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         stripe_price_id = EXCLUDED.stripe_price_id,
         tier = EXCLUDED.tier,
         extra_numbers = EXCLUDED.extra_numbers,
         status = EXCLUDED.status,
         billing_interval = EXCLUDED.billing_interval,
         current_period_end = EXCLUDED.current_period_end,
         cancel_at_period_end = EXCLUDED.cancel_at_period_end,
         updated_at = now()`,
      [
        userId, customerId, sub.id, shape.tierItem?.price.id ?? null,
        ended ? null : shape.tier?.tier ?? null, ended ? 0 : shape.extraNumbers,
        sub.status, shape.interval, subscriptionPeriodEnd(sub),
        Boolean(sub.cancel_at_period_end || sub.cancel_at),
      ],
    );
  });
  return { settle: ending };
}

/**
 * Every subscription transition goes through here (the webhook's created /
 * updated / deleted and checkout.session.completed, the checkout and change
 * routes): resolve the account, take its lock, THEN read the subscription as
 * Stripe has it now and apply the whole transition — so a snapshot that waited
 * behind another handler (an "active" that arrived after a cancellation) can
 * never restore access the current state does not grant. The Stripe calls a
 * transition leads to (cancelling a duplicate, the settlement) run after the
 * lock is released, each recorded on its own row: a failed cancel is thrown so
 * the event is retried and its row stays pending; a failed settlement stays a
 * pending job. Returns the account, or null when the subscription can't be
 * tied to one. The caller runs the number-release decision after this
 * (afterSubscriptionChange).
 */
export async function syncCallAssistantSubscription(ref: SubscriptionRef, hintUserId?: number | null, deps: SubscriptionWriteDeps = {}): Promise<number | null> {
  return (await syncCallAssistantSubscriptionState(ref, hintUserId, deps)).userId;
}

/** The transition, and whether the subscription is live as Stripe reported it under the lock (the checkout's "finished session" path asks). */
export async function syncCallAssistantSubscriptionState(ref: SubscriptionRef, hintUserId?: number | null, deps: SubscriptionWriteDeps = {}): Promise<{ userId: number | null; live: boolean }> {
  await callAssistantSchemaReady();
  const userId = await resolveAccount(ref, hintUserId);
  if (!userId) {
    console.error(`[call-assistant-billing] subscription ${ref.id} has no account (no userId metadata, unknown customer ${ref.customer === undefined ? "?" : customerIdOf(ref as Pick<Stripe.Subscription, "customer">)}).`);
    return { userId: null, live: false };
  }
  let live = false;
  const outcome = await lockFor(deps)(userId, async () => {
    const sub = await (deps.retrieve ?? retrieveAtStripe)(ref.id);
    live = LIVE_STATUSES.has(sub.status);
    return applyTransition(userId, sub, deps);
  });
  if (outcome.duplicate?.ours) await cancelDuplicate(userId, outcome.duplicate.id, deps);
  if (outcome.settle) {
    // The settlement is persisted work: a failure here is recorded on the job and retried by every sweep.
    try { await (deps.settle ?? runVoiceSettlementsForAccount)(userId); }
    catch (e: any) { console.error(`[call-assistant-billing] settlement for user ${userId} after ${ref.id} ended failed (the sweep retries):`, e?.message || e); }
  }
  return { userId, live };
}

/** Cancel one duplicate at Stripe (outside the lock) and complete ITS row by its own id; a failure is recorded on that row and thrown. */
async function cancelDuplicate(userId: number, duplicateId: string, deps: SubscriptionWriteDeps): Promise<void> {
  const facts = { userId, duplicate: duplicateId };
  try {
    await (deps.cancelDuplicate ?? cancelDuplicateAtStripe)(duplicateId);
  } catch (e: any) {
    await pool.query(`UPDATE call_assistant_duplicate_cancellations SET attempts = attempts + 1, error = $2, updated_at = now() WHERE duplicate_subscription_id = $1 AND state = 'pending'`, [duplicateId, String(e?.message || e).slice(0, 500)]).catch(() => {});
    console.error(`[call-assistant-billing] could not cancel duplicate ${duplicateId} (its row stays pending for the retry):`, e?.message || e);
    await recordFailure("call_assistant", "Duplicate Call Assistant subscription cancellation", e, facts, "critical").catch(() => {});
    throw new DuplicateSubscriptionError(userId, duplicateId, e);
  }
  await pool.query(`UPDATE call_assistant_duplicate_cancellations SET state = 'done', done_at = now(), attempts = attempts + 1, error = NULL, updated_at = now() WHERE duplicate_subscription_id = $1 AND state = 'pending'`, [duplicateId]);
  void recordFailure("call_assistant", "Duplicate Call Assistant subscription check", new Error(`${duplicateId} cancelled at Stripe (unused time credited); the duplicate's payment is the owner's to refund`), facts);
}

/** The snapshot an event or a route holds names the subscription; the state applied is what Stripe reports under the lock. */
export const applyCallAssistantSubscription = (sub: SubscriptionRef, hintUserId?: number | null, deps: SubscriptionWriteDeps = {}) => syncCallAssistantSubscription(sub, hintUserId, deps);
/** customer.subscription.deleted: the same transition (Stripe reports it canceled), its settlement job written with the end. */
export const endCallAssistantSubscription = (sub: SubscriptionRef, deps: SubscriptionWriteDeps = {}) => syncCallAssistantSubscription(sub, null, deps);

/**
 * Retry the duplicate cancellations still pending (a Stripe outage when the
 * webhook saw them), each by its own row. One already ended at Stripe is only
 * marked done. Run at boot and every six hours (startCallAssistantReconcileWorker).
 * `userIds` narrows it (tests).
 */
export async function retryDuplicateCancellations(deps: SubscriptionWriteDeps = {}, userIds?: number[]): Promise<{ retried: number; cancelled: number; failed: number }> {
  await callAssistantSchemaReady();
  const { rows } = userIds
    ? await pool.query(`SELECT user_id, duplicate_subscription_id FROM call_assistant_duplicate_cancellations WHERE state = 'pending' AND user_id = ANY($1::int[]) ORDER BY id`, [userIds])
    : await pool.query(`SELECT user_id, duplicate_subscription_id FROM call_assistant_duplicate_cancellations WHERE state = 'pending' ORDER BY id`);
  let cancelled = 0, failed = 0;
  for (const r of rows) {
    const userId = Number(r.user_id), duplicateId = String(r.duplicate_subscription_id);
    try {
      const status = await (deps.retrieveStatus ?? retrieveStatusAtStripe)(duplicateId);
      if (status && LIVE_STATUSES.has(status)) await (deps.cancelDuplicate ?? cancelDuplicateAtStripe)(duplicateId);
      await pool.query(`UPDATE call_assistant_duplicate_cancellations SET state = 'done', done_at = now(), attempts = attempts + 1, error = NULL, updated_at = now() WHERE duplicate_subscription_id = $1 AND state = 'pending'`, [duplicateId]);
      cancelled++;
      console.error(`[call-assistant-billing] duplicate ${duplicateId} for user ${userId} is now cancelled (retry); check the customer's invoices.`);
    } catch (e: any) {
      failed++;
      await pool.query(`UPDATE call_assistant_duplicate_cancellations SET attempts = attempts + 1, error = $2, updated_at = now() WHERE duplicate_subscription_id = $1`, [duplicateId, String(e?.message || e).slice(0, 500)]).catch(() => {});
      console.error(`[call-assistant-billing] retry: could not cancel duplicate ${duplicateId} for user ${userId}:`, e?.message || e);
      void recordFailure("call_assistant", "Duplicate Call Assistant subscription cancellation (retry)", e, { userId, duplicate: duplicateId }, "critical");
    }
  }
  return { retried: rows.length, cancelled, failed };
}

const RECONCILE_EVERY_MS = 6 * 60 * 60_000;
const RECONCILE_FIRST_DELAY_MS = 60_000;
let reconcileStarted = false;
/** At boot and every six hours: retry the duplicate cancellations still flagged. Off in tests and without Stripe. */
export function startCallAssistantReconcileWorker(): void {
  if (reconcileStarted || process.env.NODE_ENV === "test" || process.env.VITEST || !stripeConfigured()) return;
  reconcileStarted = true;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const out = await retryDuplicateCancellations();
      if (out.retried) console.log(`[call-assistant-billing] duplicate cancellations retried: ${JSON.stringify(out)}`);
    } catch (e: any) {
      console.error("[call-assistant-billing] duplicate retry sweep failed:", e?.message || e);
      void recordFailure("call_assistant", "Duplicate Call Assistant subscription retry sweep", e);
    } finally { running = false; }
  };
  setTimeout(run, RECONCILE_FIRST_DELAY_MS).unref();
  setInterval(run, RECONCILE_EVERY_MS).unref();
}

/** What GET /api/call-assistant/billing/subscription (and the change route) report. */
export function callAssistantSummary(row: CallAssistantSubscriptionRow | undefined) {
  const tierKey = callAssistantTierKey(row?.tier);
  const tier = tierKey ? callAssistantTier(tierKey) : null;
  const extraNumbers = tier ? row?.extra_numbers ?? 0 : 0;
  return {
    tier: tierKey,
    tierName: tier?.name ?? null,
    addon: tier?.addon ?? null,
    status: row?.status ?? "inactive",
    interval: row?.billing_interval ?? null,
    extraNumbers,
    /** The tier's numbers plus the extras — what the subscription pays for. */
    numbers: tier ? tier.includedNumbers + extraNumbers : 0,
    minutes: tier?.includedMinutes ?? 0,
    /** The add-on quantities the voice code reads ({ call_assistant_crew: 1, call_number: 2 }). */
    addons: callAssistantAddonsOf(tierKey, extraNumbers),
    currentPeriodEnd: row?.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    hasLiveSubscription: Boolean(row?.stripe_subscription_id && LIVE_STATUSES.has(row.status)),
  };
}

/** GET /api/call-assistant/billing/plans — the price book, straight from shared/plans.ts. */
export function callAssistantPriceBook() {
  return {
    currency: "usd",
    name: CALL_ASSISTANT_NAME,
    tiers: CALL_ASSISTANT_TIERS,
    extraNumber: { monthlyCents: ADDONS.call_number.monthlyCents, annualCents: ADDONS.call_number.annualCents, max: ADDON_MAX_QUANTITY },
    overageCentsPerMinute: CALL_ASSISTANT_OVERAGE_CENTS_PER_MINUTE,
    freeSpamCalls: CALL_ASSISTANT_FREE_SPAM_CALLS,
    annualMonths: CALL_ASSISTANT_ANNUAL_MONTHS,
    trialDays: 0,
    pricingHref: CALL_ASSISTANT_PRICING_HREF,
  };
}

export type CallAssistantBillingDeps = {
  /** The account's Stripe customer (created once; shared with the platform plan and the CRM). */
  getOrCreateCustomer: (userId: number, email: string) => Promise<string>;
  sendStripeError: (res: Response, err: any) => unknown;
  /** Step-up before a change that charges the saved card. */
  recentAuthOk: (req: Request, res: Response) => Promise<boolean>;
};

type PriceId = (spec: PriceSpec) => Promise<string>;

/** Checkout line items: the tier, and the extra numbers if any. */
export async function callAssistantLineItems(order: CallAssistantOrder, priceId: PriceId = (spec) => resolvePriceId(stripe, spec)) {
  const tier = callAssistantTier(order.tier);
  const items: { price: string; quantity: number }[] = [{ price: await priceId(addonPriceSpec(tier.addon, order.interval)), quantity: 1 }];
  if (order.extraNumbers > 0) {
    items.push({ price: await priceId(addonPriceSpec("call_number", order.interval)), quantity: order.extraNumbers });
  }
  return items;
}

const orderMetadata = (userId: number, order: CallAssistantOrder) => ({
  userId: String(userId), type: CALL_ASSISTANT_CHECKOUT_TYPE, product: CALL_ASSISTANT_PRODUCT,
  tier: order.tier, interval: order.interval, extraNumbers: String(order.extraNumbers),
});

type Current = ReturnType<typeof describeCallAssistantSubscription>;

/**
 * The subscription-item edits that turn `current` into `order`: the tier item
 * re-priced in place (another tier, or the other interval's price) and the
 * extra-number item added, re-quantified / re-priced or removed. One tier
 * per subscription always: the tier item is never duplicated. Stripe is
 * reached only through `priceId`, so the unit test drives it with a double.
 */
export async function callAssistantChangeItems(
  current: Pick<Current, "tierItem" | "numberItem" | "extraNumbers">,
  order: CallAssistantOrder,
  priceId: PriceId,
): Promise<Stripe.SubscriptionUpdateParams.Item[]> {
  const items: Stripe.SubscriptionUpdateParams.Item[] = [];
  const tierPrice = await priceId(addonPriceSpec(callAssistantTier(order.tier).addon, order.interval));
  if (current.tierItem) {
    if (current.tierItem.price.id !== tierPrice || (current.tierItem.quantity ?? 1) !== 1) items.push({ id: current.tierItem.id, price: tierPrice, quantity: 1 });
  } else {
    items.push({ price: tierPrice, quantity: 1 });
  }
  if (current.numberItem) {
    if (order.extraNumbers === 0) items.push({ id: current.numberItem.id, deleted: true });
    else {
      const numberPrice = await priceId(addonPriceSpec("call_number", order.interval));
      if (current.numberItem.price.id !== numberPrice || current.extraNumbers !== order.extraNumbers) {
        items.push({ id: current.numberItem.id, price: numberPrice, quantity: order.extraNumbers });
      }
    }
  } else if (order.extraNumbers > 0) {
    items.push({ price: await priceId(addonPriceSpec("call_number", order.interval)), quantity: order.extraNumbers });
  }
  return items;
}

/** Stripe pages at 100; read to the end (a long-standing customer can have more subscriptions or sessions than one page). */
const LIST_PAGES_MAX = 50;

/** Every Call Assistant subscription on the customer, whatever its status, oldest first. */
export async function listCallAssistantSubscriptions(customerId: string): Promise<Stripe.Subscription[]> {
  const out: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < LIST_PAGES_MAX; page++) {
    const res = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    out.push(...res.data.filter((s) => isCallAssistantSubscription(s)));
    if (!res.has_more || !res.data.length) break;
    startingAfter = res.data[res.data.length - 1].id;
  }
  return out.sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
}

/** Every open Call Assistant Checkout Session on the customer. */
async function listOpenCallAssistantSessions(customerId: string): Promise<Stripe.Checkout.Session[]> {
  const out: Stripe.Checkout.Session[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < LIST_PAGES_MAX; page++) {
    const res = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    out.push(...res.data.filter((s) => s.mode === "subscription" && isCallAssistantCheckoutSession(s)));
    if (!res.has_more || !res.data.length) break;
    startingAfter = res.data[res.data.length - 1].id;
  }
  return out;
}

/** The order a Checkout Session was opened for, as its metadata spells it. */
const sameOrder = (session: Pick<Stripe.Checkout.Session, "metadata">, order: CallAssistantOrder) =>
  session.metadata?.tier === order.tier && session.metadata?.interval === order.interval && session.metadata?.extraNumbers === String(order.extraNumbers);

/** The order a checkout attempt is for, as the attempt row keeps it. */
const orderKeyOf = (order: CallAssistantOrder) => `${order.tier}:${order.interval}:${order.extraNumbers}`;
/** The order back out of an attempt row's key, or null when it is not one. */
function parseOrderKey(key: string | null): CallAssistantOrder | null {
  const m = /^(lite|solo|crew|fleet):(month|year):(\d+)$/.exec(key ?? "");
  return m ? { tier: m[1] as CallAssistantOrder["tier"], interval: m[2] as CallAssistantOrder["interval"], extraNumbers: Number(m[3]) } : null;
}
/**
 * How long an attempt may sit `creating` before, not applied at Stripe, it is taken for abandoned (a crash, a
 * timeout long past) rather than in flight: well beyond one Stripe call's own timeout (billing/client.ts).
 */
const attemptGraceMs = () => Math.max(60_000, 3 * stripeTimeoutMs());
const ageMs = (row: CallAssistantAttemptRow) => (row.created_at ? Date.now() - new Date(row.created_at).getTime() : Number.POSITIVE_INFINITY);
/** Stripe's idempotency key for one attempt: the same attempt replayed returns the same session / update. */
export const attemptIdempotencyKey = (kind: "checkout" | "change", attemptId: string) => `chub-ca-${kind}-${attemptId}`;
export const checkoutIdempotencyKey = (attemptId: string) => attemptIdempotencyKey("checkout", attemptId);

/** The account's checkout or change still in flight (one at most: the partial unique index). */
async function inFlightAttempt(userId: number): Promise<CallAssistantAttemptRow | null> {
  const { rows: [row] } = await pool.query(`SELECT * FROM call_assistant_checkout_attempts WHERE user_id = $1 AND state IN ('creating', 'open') ORDER BY created_at DESC LIMIT 1`, [userId]);
  return row ?? null;
}

/**
 * Start an attempt, under the account lock, BEFORE Stripe is asked: the row is the account's lock across
 * processes (a second insert while one is in flight fails on the partial unique index → "in progress").
 */
async function insertAttempt(userId: number, kind: "checkout" | "change", orderKey: string, customerId: string | null, subscriptionId: string | null = null): Promise<CallAssistantAttemptRow> {
  const id = randomUUID();
  try {
    const { rows: [row] } = await pool.query(
      `INSERT INTO call_assistant_checkout_attempts (id, user_id, kind, state, order_key, stripe_customer_id, stripe_subscription_id, idempotency_key)
       VALUES ($1, $2, $3, 'creating', $4, $5, $6, $7) RETURNING *`,
      [id, userId, kind, orderKey, customerId, subscriptionId, attemptIdempotencyKey(kind, id)]);
    return row;
  } catch (e: any) {
    if (e?.code === "23505") throw inProgress();
    throw e;
  }
}

/** One attempt, as the row has it now. */
async function attemptById(id: string): Promise<CallAssistantAttemptRow | null> {
  const { rows: [row] } = await pool.query(`SELECT * FROM call_assistant_checkout_attempts WHERE id = $1`, [id]);
  return row ?? null;
}

/**
 * A Stripe error that DEFINITELY means the request was not applied (a 4xx: the card, a bad parameter, a
 * missing object) — only those close an attempt as failed; a timeout, a dropped connection or a 5xx leaves
 * it `creating`, to be reconciled against Stripe before another is accepted.
 */
const definiteStripeError = (e: any): boolean => {
  const status = Number(e?.statusCode);
  const type = String(e?.type ?? "");
  if (type === "StripeConnectionError" || type === "StripeAPIError" || type === "StripeRateLimitError") return false;
  return Number.isFinite(status) && status >= 400 && status < 500;
};

/** Move an attempt on, conditionally on the state it is expected to be in; true when this call moved it. */
async function finishAttempt(id: string, to: "open" | "done" | "failed" | "expired", from: "creating" | "open", extra: { sessionId?: string | null; sessionUrl?: string | null; error?: string | null } = {}): Promise<boolean> {
  const { rows } = await pool.query(
    `UPDATE call_assistant_checkout_attempts SET state = $2, session_id = COALESCE($4, session_id), session_url = COALESCE($5, session_url), error = $6,
       finished_at = CASE WHEN $2 IN ('done', 'failed', 'expired') THEN now() ELSE finished_at END, updated_at = now()
      WHERE id = $1 AND state = $3 RETURNING id`,
    [id, to, from, extra.sessionId ?? null, extra.sessionUrl ?? null, extra.error ?? null]);
  return rows.length === 1;
}

const inProgress = () => new BillingRequestError(409, "Another checkout or change for this account is in progress. Try again in a moment.", "checkout_in_progress");

/** What the platform admin sees of the service's billing machinery: the overage switch, the constraints, the work still open. */
export async function callAssistantBillingAdminStatus() {
  await callAssistantSchemaReady();
  const { rows: [d] } = await pool.query(`SELECT count(*) FILTER (WHERE state = 'pending')::int AS pending, count(*) FILTER (WHERE state = 'skipped')::int AS skipped FROM call_assistant_duplicate_cancellations`);
  const { rows: [a] } = await pool.query(`SELECT count(*)::int AS in_flight FROM call_assistant_checkout_attempts WHERE state IN ('creating', 'open')`);
  return {
    ...(await voiceOverageAdminStatus()),
    duplicates: { pending: Number(d?.pending ?? 0), notOurs: Number(d?.skipped ?? 0) },
    checkoutsInFlight: Number(a?.in_flight ?? 0),
  };
}

export function registerCallAssistantBillingRoutes(app: Express, deps: CallAssistantBillingDeps) {
  void callAssistantSchemaReady();
  startCallAssistantReconcileWorker();

  app.get("/api/call-assistant/billing/plans", (_req, res) => res.json(callAssistantPriceBook()));

  app.get("/api/call-assistant/billing/subscription", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const [row, ent] = await Promise.all([callAssistantSubscriptionRow(user.id), getEntitlements(user.id)]);
      res.json({
        ...callAssistantSummary(row),
        access: {
          enabled: ent.addonModules.callAssistant,
          paused: ent.addonModulesPaused.callAssistant,
          via: ent.isPlatformAdmin ? ("admin" as const) : ent.addonModules.callAssistant ? ("subscription" as const) : null,
        },
        /** "off": minutes above the tier are metered and shown but not charged (CALL_ASSISTANT_OVERAGE_BILLING, default off). */
        overageBilling: voiceOverageBillingState(),
      });
    } catch (err: any) {
      deps.sendStripeError(res, err);
    }
  });

  // Platform admin (server/admin.ts ADMIN_EMAILS): the overage switch, the database constraints in place, and the work still open (counts only).
  app.get("/api/admin/call-assistant-billing", async (req: any, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Not authenticated" });
      const { rows: [account] } = await pool.query("SELECT email FROM users WHERE id = $1", [req.user.id]);
      if (!account || !isPlatformAdminEmail(account.email)) return res.status(403).json({ message: "Platform admin access required" });
      res.setHeader("Cache-Control", "no-store");
      res.json(await callAssistantBillingAdminStatus());
    } catch (err: any) {
      deps.sendStripeError(res, err);
    }
  });

  app.post("/api/call-assistant/billing/checkout", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const ent = await getEntitlements(user.id);
      if (ent.isPlatformAdmin) {
        return res.status(400).json({ message: `Your account already includes the ${CALL_ASSISTANT_NAME} — no payment needed.` });
      }
      const order = parseCallAssistantOrder(req.body ?? {});
      const orderKey = orderKeyOf(order);
      const already = () => new BillingRequestError(409,
        `You already have an ${CALL_ASSISTANT_NAME} subscription. Change its tier or extra numbers from Settings → Billing — that updates it in place instead of starting a second one.`,
        "has_call_assistant_subscription");

      /** A Checkout Session that finished: its subscription is recorded (the transition under the lock); while that one lives, this is a second checkout. */
      const finished = async (session: Stripe.Checkout.Session): Promise<void> => {
        const id = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (!id) return;
        const { live } = await syncCallAssistantSubscriptionState({ id }, user.id);
        await afterSubscriptionChange(user.id);
        if (live) throw already();
      };
      /** Expire an open session; one that completed in the meantime can't be expired — it is then the subscription. */
      const expireOrFinish = async (sessionId: string) => {
        try { await stripe.checkout.sessions.expire(sessionId); }
        catch (e) {
          const again = await stripe.checkout.sessions.retrieve(sessionId);
          if (again.status === "complete") return finished(again);
          if (again.status === "open") throw e;
        }
      };
      /** Under the account's lock, database only: refused while the row tracks a live subscription; else the attempt in flight, or a new one. */
      const takeAttempt = () => withCallAssistantLock(user.id, async () => {
        const row = await callAssistantSubscriptionRow(user.id);
        if (row?.stripe_subscription_id && LIVE_STATUSES.has(row.status)) throw already();
        const customerId = await deps.getOrCreateCustomer(user.id, user.email);
        let inFlight = await inFlightAttempt(user.id);
        // A change attempt with no live subscription left to change is obsolete (the subscription ended; its end
        // voids open attempts, but one recorded before that rule, or whose end never arrived, is voided here).
        if (inFlight?.kind === "change") {
          await finishAttempt(inFlight.id, "expired", inFlight.state === "open" ? "open" : "creating", { error: "the subscription it changed has ended; voided" });
          inFlight = await inFlightAttempt(user.id);
        }
        return { customerId, attempt: inFlight ?? await insertAttempt(user.id, "checkout", orderKey, customerId) };
      });

      // The attempt row is the account's checkout lock across processes: taken (or found) under the database
      // lock, carried through every Stripe call outside it, completed conditionally on its id and state.
      const url = await withBillingLock(user.id, async () => {
        let { customerId, attempt } = await takeAttempt();
        // 1. Something else in flight. A change: voided by takeAttempt (no live subscription is left for it to
        //    change). A checkout for another order still being created: wait while fresh, voided once abandoned.
        //    An open session for another order: expired, the attempt closed, a new one taken. The same order
        //    with a session open: the visitor goes back to it — unless it finished (that is the subscription)
        //    or expired at Stripe (a new attempt). The same order still being created in another process:
        //    resumed — the attempt's key makes Stripe answer with the same session.
        if (attempt.kind !== "checkout") throw inProgress();
        if (attempt.order_key !== orderKey) {
          // Another order still being created: a fresh one is another process's — wait; one abandoned (older than
          // any Stripe call can take) is voided under the lock, and whatever session it may have made is expired in
          // step 3 (its metadata names that attempt, not this one) or, completed, is the subscription (step 2).
          if (attempt.state === "creating") {
            const abandoned = attempt;
            if (ageMs(abandoned) <= attemptGraceMs()) throw inProgress();
            await withCallAssistantLock(user.id, () => finishAttempt(abandoned.id, "expired", "creating", { error: "abandoned for another order; voided" }));
          } else {
            if (attempt.session_id) await expireOrFinish(attempt.session_id);
            await finishAttempt(attempt.id, "expired", "open");
          }
          ({ customerId, attempt } = await takeAttempt());
          if (attempt.state !== "creating" || attempt.order_key !== orderKey) throw inProgress();
        } else if (attempt.state === "open" && attempt.session_id) {
          let session: Stripe.Checkout.Session | null = null;
          try { session = await stripe.checkout.sessions.retrieve(attempt.session_id); }
          catch (e: any) { if (e?.statusCode !== 404 && e?.code !== "resource_missing") throw e; }
          if (session?.status === "open" && session.url) return session.url;
          if (session?.status === "complete") { await finishAttempt(attempt.id, "done", "open"); await finished(session); }
          await finishAttempt(attempt.id, "expired", "open");
          ({ customerId, attempt } = await takeAttempt());
          if (attempt.state !== "creating" || attempt.order_key !== orderKey) throw inProgress();
        }
        // 2. Ask Stripe too (outside the lock): the row can lag the webhook. Only Call Assistant subscriptions
        //    count — the platform plan and the CRM are other subscriptions on this customer. The tracked one,
        //    else the oldest, is the account's; any other live one is a duplicate the transition reconciles.
        const live = (await listCallAssistantSubscriptions(customerId)).filter((s) => LIVE_STATUSES.has(s.status));
        if (live.length) {
          const row = await callAssistantSubscriptionRow(user.id);
          const tracked = live.find((s) => s.id === row?.stripe_subscription_id) ?? live[0];
          await syncCallAssistantSubscription(tracked, user.id);
          for (const other of live) if (other.id !== tracked.id) await syncCallAssistantSubscription(other, user.id);
          await afterSubscriptionChange(user.id);
          await finishAttempt(attempt.id, "done", "creating");
          throw already();
        }
        // 3. Any other open Call Assistant checkout on the customer (opened before attempts were kept, or whose
        //    completion write failed) is expired first, so finishing both can't start two.
        for (const stale of await listOpenCallAssistantSessions(customerId)) {
          // Never this attempt's own session: the one recorded on it, or one another process created for it a
          // moment ago under the same key (its metadata names the attempt).
          if (stale.id === attempt.session_id || stale.metadata?.attempt === attempt.id) continue;
          await expireOrFinish(stale.id);
        }
        // 4. The create, with the attempt's key (a replay of this attempt gets this session back). No trial and
        //    no intro coupon: the service is billed from the first invoice at the price book's price.
        const metadata = orderMetadata(user.id, order);
        const base = appReturnBaseUrl(req);
        let session: Stripe.Checkout.Session;
        try {
          session = await stripe.checkout.sessions.create({
            customer: customerId,
            mode: "subscription",
            line_items: await callAssistantLineItems(order),
            subscription_data: { metadata },
            success_url: `${base}/pricing?call_assistant_success=true#call-assistant`,
            cancel_url: `${base}/pricing?call_assistant_canceled=true#call-assistant`,
            metadata: { ...metadata, attempt: attempt.id },
          }, { idempotencyKey: attempt.idempotency_key });
        } catch (e: any) {
          // A DEFINITE refusal (a 4xx: nothing was created) closes the attempt, so the next order can proceed; an
          // uncertain outcome (a timeout) leaves it `creating`: the next checkout resumes it under the same key.
          if (definiteStripeError(e)) await finishAttempt(attempt.id, "failed", "creating", { error: String(e?.message || e).slice(0, 500) }).catch(() => {});
          throw e;
        }
        // 5. Completion, under the lock, conditional on the attempt still being ours (still `creating`) and the
        //    row still not live. Losing the write means one of two things, told apart by rereading the attempt:
        //    another process resumed the same attempt and recorded the session first (the same session — the key)
        //    → that session is returned, nothing expired; or a subscription landed meanwhile (the webhook won,
        //    closing the attempt) → this session is expired and the visitor is told they already have the service.
        const completed = await withCallAssistantLock(user.id, async () => {
          const row = await callAssistantSubscriptionRow(user.id);
          if (row?.stripe_subscription_id && LIVE_STATUSES.has(row.status)) return false;
          return finishAttempt(attempt.id, "open", "creating", { sessionId: session.id, sessionUrl: session.url });
        });
        if (!completed) {
          const recorded = await attemptById(attempt.id);
          if (recorded?.state === "open" && recorded.session_id) return recorded.session_url ?? session.url;
          await stripe.checkout.sessions.expire(session.id).catch(() => {});
          throw already();
        }
        return session.url;
      });
      res.json({ url });
    } catch (err: any) {
      deps.sendStripeError(res, err);
    }
  });

  app.post("/api/call-assistant/billing/change", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      if (!(await deps.recentAuthOk(req, res))) return;

      const result = await withBillingLock(user.id, async () => {
        // The attempt row is the lock across processes (one checkout or change in flight per account); the
        // Stripe read and write happen outside the database lock; the transition that records the result takes
        // it again and reads Stripe's state inside it (syncCallAssistantSubscription).
        // A. Under the lock: the row, and whatever is in flight — a checkout: wait; a change attempt left
        //    `creating` (a crash, a timeout, another process): not refused for ever — RECONCILED below against
        //    Stripe's state, and resumed under its own key when it is this very order.
        const { row, inFlight } = await withCallAssistantLock(user.id, async () => {
          const r = await callAssistantSubscriptionRow(user.id);
          if (!r?.stripe_subscription_id || !LIVE_STATUSES.has(r.status)) {
            throw new BillingRequestError(409, `You don't have an ${CALL_ASSISTANT_NAME} subscription to change. Choose a tier on Pricing to start one.`, "no_call_assistant_subscription");
          }
          const inFlight = await inFlightAttempt(user.id);
          if (inFlight && inFlight.kind !== "change") throw inProgress();
          return { row: r, inFlight };
        });
        // B. Stripe's state, outside the lock: what the subscription is now decides whether an earlier attempt was applied.
        const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id!);
        if (!LIVE_STATUSES.has(sub.status)) {
          await syncCallAssistantSubscription(sub, user.id);
          await afterSubscriptionChange(user.id);
          throw new BillingRequestError(409, `Your ${CALL_ASSISTANT_NAME} subscription has ended. Choose a tier on Pricing to start a new one.`, "no_call_assistant_subscription");
        }
        const current = describeCallAssistantSubscription(sub);
        // C. The attempt in flight is reconciled by ITS OWN order against Stripe, whatever the customer asks next:
        //    applied (the subscription is what it asked for) → closed as done; not applied and old enough that no
        //    process can still be mid-update → voided; not applied and fresh → another process may be on it: wait,
        //    unless this very order resumes it below.
        //    The close is under the account lock, conditional on the attempt still being `creating`.
        let stale: CallAssistantAttemptRow | null = inFlight;
        if (stale) {
          const held = stale;
          const own = parseOrderKey(held.order_key);
          const applied = !!own && current.tier?.tier === own.tier && current.interval === own.interval && current.extraNumbers === own.extraNumbers;
          const verdict = applied ? "done" as const : ageMs(held) > attemptGraceMs() ? "expired" as const : null;
          if (verdict) {
            await withCallAssistantLock(user.id, () => finishAttempt(held.id, verdict, "creating", verdict === "expired" ? { error: "not applied at Stripe; voided" } : {}));
            stale = null;
          }
        }
        const order = parseCallAssistantOrder(req.body ?? {}, {
          tier: current.tier?.tier, interval: current.interval ?? undefined, extraNumbers: current.extraNumbers,
        });
        const orderKey = orderKeyOf(order);
        if (current.tier?.tier === order.tier && current.interval === order.interval && current.extraNumbers === order.extraNumbers) {
          await syncCallAssistantSubscription(sub, user.id);
          return { changed: false, subscription: callAssistantSummary(await callAssistantSubscriptionRow(user.id)) };
        }
        // D. The attempt: a fresh one in flight for this very order is resumed (the same key: Stripe applies the
        //    update once); a fresh one for another order is still another process's — wait; otherwise a new one.
        let attempt: CallAssistantAttemptRow;
        if (stale) {
          if (stale.order_key !== orderKey) throw inProgress();
          attempt = stale;
        } else {
          attempt = await withCallAssistantLock(user.id, async () => {
            if (await inFlightAttempt(user.id)) throw inProgress();
            return insertAttempt(user.id, "change", orderKey, row.stripe_customer_id, row.stripe_subscription_id);
          });
        }
        try {
          const items = await callAssistantChangeItems(current, order, (spec) => resolvePriceId(stripe, spec));
          // Repriced in place with proration, invoiced immediately; if the card can't pay, Stripe rejects the
          // update and nothing changes (error_if_incomplete). The attempt's key: a replay changes nothing twice.
          const updated = await stripe.subscriptions.update(sub.id, {
            items,
            proration_behavior: "always_invoice",
            payment_behavior: "error_if_incomplete",
            metadata: orderMetadata(user.id, order),
          }, { idempotencyKey: attempt.idempotency_key });
          await syncCallAssistantSubscription(updated, user.id);
          // A smaller tier or fewer extra numbers than the org holds: the newest extras are released.
          await afterSubscriptionChange(user.id);
          await finishAttempt(attempt.id, "done", "creating");
          return { changed: true, subscription: callAssistantSummary(await callAssistantSubscriptionRow(user.id)) };
        } catch (e: any) {
          // Only a DEFINITE Stripe refusal closes the attempt; a timeout or an unknown outcome leaves it `creating`
          // (Stripe may still have applied it): the next change for this account reconciles it first.
          if (definiteStripeError(e)) await finishAttempt(attempt.id, "failed", "creating", { error: String(e?.message || e).slice(0, 500) }).catch(() => {});
          else await pool.query(`UPDATE call_assistant_checkout_attempts SET error = $2, updated_at = now() WHERE id = $1 AND state = 'creating'`, [attempt.id, String(e?.message || e).slice(0, 500)]).catch(() => {});
          throw e;
        }
      });
      forgetDashboard(user.id);
      res.json(result);
    } catch (err: any) {
      deps.sendStripeError(res, err);
    }
  });
}
