/**
 * Selling the tools à la carte — each item its own Stripe subscription, apart
 * from the platform plan, the CRM and the Call Assistant (owner, 2026-10-10:
 * "every single tool should be a stand alone service"; the CRM's pattern,
 * server/crm/billing.ts).
 *
 *   GET  /api/alacarte/me         this account's à la carte items, the tier it pays and what it already has
 *   POST /api/alacarte/checkout   start one item (Stripe Checkout; a buyer with no plan can buy)
 *
 * One account, one Stripe customer, any number of subscriptions: the platform
 * plan (server/stripe.ts), the CRM, the Call Assistant and one per à la carte
 * item (here, table `alacarte_subscriptions`, ./alacarte-store). An à la carte
 * subscription is marked metadata.product = "alacarte" and is made of ONE à la
 * carte price (./prices alacartePriceSpec: `<prefix>_alacarte_<key>_<tier>_<interval>_<cents>`);
 * the platform webhook hands every event for one to the handlers below and
 * never writes it to `subscriptions`.
 *
 * The price in force is the account's TIER (shared/alacarte.ts alacarteTierFor):
 * add-on with an active paid Business Tools or CRM plan, standalone without.
 * When a plan starts or ends, reconcileAlacartePricing() moves every live
 * item to the other tier's price with proration_behavior "none": the current
 * cycle is left as paid, and the next invoice bills the new price. Never a
 * mid-cycle charge or credit (docs/pricing/README.md → "À la carte").
 */
import type Stripe from "stripe";
import type { Express, Request, Response } from "express";
import { pool } from "../db";
import { stripe } from "./client";
import { BillingRequestError } from "./order";
import { LIVE_STATUSES, subscriptionPeriodEnd, withBillingLock } from "./sync";
import { alacartePriceSpec, resolvePriceId, roleOfPrice } from "./prices";
import { appReturnBaseUrl } from "../site-context";
import { getEntitlements } from "../entitlements";
import { getCrmEntitlements } from "../crm/entitlements";
import { forgetDashboard } from "../dashboard/cache";
import { ACCESS_STATUSES, TALK_TO_SALES_CODE, type BillingInterval } from "@shared/plans";
import { CRM_PLANS } from "@shared/crm-plans";
import {
  ALACARTE, ALACARTE_KEYS, ALACARTE_MAX_QUANTITY, ALACARTE_PRICING_HREF, alacarteAlreadyCovered, alacartePriceCents, alacarteTierFor, isAlacarteKey,
  type AlacarteAccount, type AlacarteKey, type AlacarteTier,
} from "@shared/alacarte";
import {
  alacarteSchemaReady, alacarteSubscriptionRow, alacarteSubscriptionRows, alacarteIntervalOf, type AlacarteSubscriptionRow,
} from "./alacarte-store";

export const ALACARTE_PRODUCT = "alacarte";
export const ALACARTE_CHECKOUT_TYPE = "alacarte";

/** A Stripe subscription that is an à la carte item (ours to handle, never the platform's). */
export function isAlacarteSubscription(sub: Pick<Stripe.Subscription, "metadata" | "items"> | null | undefined): boolean {
  if (!sub) return false;
  if (sub.metadata?.product === ALACARTE_PRODUCT) return true;
  return (sub.items?.data ?? []).some((item) => roleOfPrice(item.price)?.kind === "alacarte");
}

export const isAlacarteCheckoutSession = (session: Pick<Stripe.Checkout.Session, "metadata"> | null | undefined) =>
  session?.metadata?.type === ALACARTE_CHECKOUT_TYPE;

export type AlacarteOrder = { key: AlacarteKey; interval: BillingInterval; quantity: number };

/** The order a request asks for: an item, monthly or yearly, and (for a per-unit item) how many units. */
export function parseAlacarteOrder(body: any): AlacarteOrder {
  const key = body?.key ?? body?.item;
  if (!isAlacarteKey(key)) {
    throw new BillingRequestError(400, `Choose a tool: ${ALACARTE_KEYS.map((k) => ALACARTE[k].name).join(", ")}.`, "unknown_item");
  }
  const rawInterval = body?.interval ?? "month";
  if (rawInterval !== "month" && rawInterval !== "year") {
    throw new BillingRequestError(400, "Billing is monthly or yearly.", "unknown_interval");
  }
  const rawQuantity = body?.quantity ?? 1;
  if (typeof rawQuantity !== "number" || !Number.isInteger(rawQuantity) || rawQuantity < 1) {
    throw new BillingRequestError(400, "Quantity must be a whole number, 1 or more.", "bad_quantity");
  }
  const unit = ALACARTE[key].unit;
  if (!unit && rawQuantity !== 1) {
    throw new BillingRequestError(400, `${ALACARTE[key].name} is one per account.`, "bad_quantity");
  }
  if (rawQuantity > ALACARTE_MAX_QUANTITY) {
    throw new BillingRequestError(409, `For more than ${ALACARTE_MAX_QUANTITY} ${unit}s, talk to a sales rep. Nothing was charged.`, TALK_TO_SALES_CODE);
  }
  return { key, interval: rawInterval, quantity: rawQuantity };
}

/** What an à la carte Stripe subscription says: the item, the tier it is billed at, the interval, the quantity and the item line. */
export function describeAlacarteSubscription(sub: Pick<Stripe.Subscription, "items" | "metadata">) {
  let key: AlacarteKey | null = null, tier: AlacarteTier | null = null, interval: BillingInterval | null = null, quantity = 1;
  let item: Stripe.SubscriptionItem | null = null;
  for (const line of sub.items?.data ?? []) {
    const role = roleOfPrice(line.price);
    if (role?.kind !== "alacarte" || item) continue;
    key = role.key; tier = role.tier; interval = role.interval; item = line; quantity = Math.max(1, line.quantity ?? 1);
  }
  // A price we did not create (a sales rep's): the metadata still names the item.
  if (!key && isAlacarteKey(sub.metadata?.item)) key = sub.metadata!.item as AlacarteKey;
  if (!interval) {
    const first = (sub.items?.data ?? []).map((i) => i.price?.recurring?.interval).find((i) => i === "month" || i === "year");
    interval = (first as BillingInterval | undefined) ?? null;
  }
  return { key, tier, interval, quantity, item };
}

const customerIdOf = (sub: Pick<Stripe.Subscription, "customer">): string | null =>
  typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

/** The account a subscription belongs to: our metadata, then the row that tracks it, then the Stripe customer. */
async function resolveAccount(sub: Stripe.Subscription, hintUserId?: number | null): Promise<number | null> {
  let userId = hintUserId || parseInt(sub.metadata?.userId || "0") || null;
  if (!userId) {
    const { rows: [bySub] } = await pool.query(`SELECT user_id FROM alacarte_subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`, [sub.id]);
    userId = bySub?.user_id ?? null;
  }
  const customerId = customerIdOf(sub);
  if (!userId && customerId) {
    const { rows: [byCustomer] } = await pool.query(`SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1`, [customerId]);
    userId = byCustomer?.user_id ?? null;
  }
  return userId ? Number(userId) : null;
}

/**
 * Record an à la carte Stripe subscription on the account's row for its item
 * (insert or update). The row tracks ONE subscription per item: a late event
 * for an older, ended one never overwrites a live one. Returns the account, or
 * null when the subscription can't be tied to one.
 */
export async function applyAlacarteSubscription(sub: Stripe.Subscription, hintUserId?: number | null): Promise<number | null> {
  await alacarteSchemaReady();
  const userId = await resolveAccount(sub, hintUserId);
  if (!userId) {
    console.error(`[alacarte-billing] subscription ${sub.id} has no account (no userId metadata, unknown customer ${customerIdOf(sub)}).`);
    return null;
  }
  const shape = describeAlacarteSubscription(sub);
  if (!shape.key) {
    console.error(`[alacarte-billing] subscription ${sub.id} (user ${userId}) names no à la carte item; not recorded.`);
    return userId;
  }
  const existing = await alacarteSubscriptionRow(userId, shape.key);
  const live = LIVE_STATUSES.has(sub.status);
  if (existing?.stripe_subscription_id && existing.stripe_subscription_id !== sub.id && LIVE_STATUSES.has(existing.status)) {
    if (!live) return userId;
    // Checkout refuses live holders and expires stale sessions, so this should not happen; if it does, both bill — say so loudly.
    console.error(`[alacarte-billing] user ${userId} now has two live subscriptions for ${shape.key} (${existing.stripe_subscription_id} and ${sub.id}); tracking the new one — cancel the other in Stripe.`);
  }
  const ended = !live;
  const tier: AlacarteTier = shape.tier ?? (existing?.tier === "addon" ? "addon" : "standalone");
  await pool.query(
    `INSERT INTO alacarte_subscriptions
       (user_id, item_key, tier, quantity, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, billing_interval,
        current_period_end, cancel_at_period_end, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
     ON CONFLICT (user_id, item_key) DO UPDATE SET
       tier = EXCLUDED.tier,
       quantity = EXCLUDED.quantity,
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       stripe_price_id = EXCLUDED.stripe_price_id,
       status = EXCLUDED.status,
       billing_interval = EXCLUDED.billing_interval,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       updated_at = now()`,
    [
      userId, shape.key, tier, ended ? 1 : shape.quantity, customerIdOf(sub), sub.id, shape.item?.price.id ?? null,
      sub.status, shape.interval, subscriptionPeriodEnd(sub), Boolean(sub.cancel_at_period_end || sub.cancel_at),
    ],
  );
  forgetDashboard(userId);
  return userId;
}

/** The tracked subscription ended: the row keeps its history and loses access. */
export async function endAlacarteSubscription(sub: Stripe.Subscription): Promise<number | null> {
  await alacarteSchemaReady();
  const { rows: [row] } = await pool.query(
    `UPDATE alacarte_subscriptions SET status = 'canceled', cancel_at_period_end = NULL, updated_at = now()
      WHERE stripe_subscription_id = $1 RETURNING user_id`, [sub.id]);
  if (row?.user_id) forgetDashboard(row.user_id);
  return row?.user_id ?? null;
}

/** The plans that decide an account's tier: its own active platform plan, and a PAID CRM plan (never a beta or admin grant). */
export async function alacarteAccountOf(userId: number): Promise<AlacarteAccount & { entitlements: Awaited<ReturnType<typeof getEntitlements>>; crmPlanActive: boolean; crmJobcam: boolean }> {
  const [ent, crm] = await Promise.all([getEntitlements(userId), getCrmEntitlements(userId, { fresh: true })]);
  const crmPlan = crm.via === "plan" ? crm.plan : null;
  return { plan: ent.plan, crmPlan, entitlements: ent, crmPlanActive: !!crmPlan, crmJobcam: crm.jobcam };
}

/** The items in force (active or trialing) among an account's rows. */
export const activeKeysOf = (rows: readonly Pick<AlacarteSubscriptionRow, "item_key" | "status">[]): AlacarteKey[] =>
  rows.filter((r) => ACCESS_STATUSES.includes(r.status) && isAlacarteKey(r.item_key)).map((r) => r.item_key as AlacarteKey);

/** What a row says, for GET /api/alacarte/me. */
export function alacarteRowSummary(row: AlacarteSubscriptionRow) {
  const key = isAlacarteKey(row.item_key) ? row.item_key : null;
  return {
    key,
    name: key ? ALACARTE[key].name : row.item_key,
    tier: row.tier === "addon" ? "addon" as const : "standalone" as const,
    quantity: Math.max(1, Number(row.quantity) || 1),
    status: row.status,
    interval: alacarteIntervalOf(row.billing_interval),
    currentPeriodEnd: row.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    active: ACCESS_STATUSES.includes(row.status),
    hasLiveSubscription: Boolean(row.stripe_subscription_id && LIVE_STATUSES.has(row.status)),
  };
}

/**
 * The tier the account should be billed at from its next renewal, against
 * each live item's current tier: the items to move. Pure — the test drives it.
 */
export function alacarteRepricingPlan(rows: readonly Pick<AlacarteSubscriptionRow, "item_key" | "tier" | "status" | "stripe_subscription_id">[], account: AlacarteAccount) {
  const tier = alacarteTierFor(account);
  return {
    tier,
    moves: rows
      .filter((r) => r.stripe_subscription_id && LIVE_STATUSES.has(r.status) && isAlacarteKey(r.item_key) && r.tier !== tier)
      .map((r) => ({ key: r.item_key as AlacarteKey, from: (r.tier === "addon" ? "addon" : "standalone") as AlacarteTier, to: tier, subscriptionId: r.stripe_subscription_id! })),
  };
}

/**
 * A plan started or ended: move every live à la carte item to the tier the
 * account now pays, AT THE NEXT RENEWAL — the item's price is swapped with
 * proration_behavior "none", so the cycle already paid is untouched and the
 * next invoice bills the new price. Never throws: a failure is logged and the
 * next plan event (or a manual run) tries again. Called by the webhook after
 * every platform and CRM subscription write.
 */
export async function reconcileAlacartePricing(userId: number | null | undefined): Promise<{ moved: number; failed: number }> {
  const out = { moved: 0, failed: 0 };
  if (!userId) return out;
  try {
    const rows = await alacarteSubscriptionRows(userId);
    if (!rows.some((r) => r.stripe_subscription_id && LIVE_STATUSES.has(r.status))) return out;
    const account = await alacarteAccountOf(userId);
    const plan = alacarteRepricingPlan(rows, account);
    for (const move of plan.moves) {
      try {
        const sub = await stripe.subscriptions.retrieve(move.subscriptionId);
        if (!LIVE_STATUSES.has(sub.status)) { await applyAlacarteSubscription(sub, userId); continue; }
        const shape = describeAlacarteSubscription(sub);
        if (!shape.item || !shape.interval || shape.tier === move.to) continue;
        const price = await resolvePriceId(stripe, alacartePriceSpec(move.key, move.to, shape.interval));
        const updated = await stripe.subscriptions.update(sub.id, {
          items: [{ id: shape.item.id, price, quantity: shape.quantity }],
          // The cycle already paid stays as it is; the new price starts on the next invoice.
          proration_behavior: "none",
          metadata: { ...sub.metadata, tier: move.to },
        });
        await applyAlacarteSubscription(updated, userId);
        out.moved++;
        console.log(`[alacarte-billing] user ${userId}: ${move.key} moves from the ${move.from} to the ${move.to} price at its next renewal (${sub.id}).`);
      } catch (e: any) {
        out.failed++;
        console.error(`[alacarte-billing] could not reprice ${move.key} (${move.subscriptionId}) for user ${userId} (the next plan event retries):`, e?.message || e);
      }
    }
  } catch (e: any) {
    console.error(`[alacarte-billing] repricing check for user ${userId} failed:`, e?.message || e);
  }
  return out;
}

export type AlacarteBillingDeps = {
  /** The account's Stripe customer (created once; shared with every product). */
  getOrCreateCustomer: (userId: number, email: string) => Promise<string>;
  sendStripeError: (res: Response, err: any) => unknown;
};

const orderMetadata = (userId: number, order: AlacarteOrder, tier: AlacarteTier) => ({
  userId: String(userId), type: ALACARTE_CHECKOUT_TYPE, product: ALACARTE_PRODUCT,
  item: order.key, tier, interval: order.interval, quantity: String(order.quantity),
});

/** Stripe pages at 100; a long-standing customer can hold more subscriptions than one page. */
const LIST_PAGES_MAX = 20;

/** Every à la carte subscription on the customer for one item, whatever its status. */
async function listAlacarteSubscriptions(customerId: string, key: AlacarteKey): Promise<Stripe.Subscription[]> {
  const out: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < LIST_PAGES_MAX; page++) {
    const res = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    out.push(...res.data.filter((s) => isAlacarteSubscription(s) && describeAlacarteSubscription(s).key === key));
    if (!res.has_more || !res.data.length) break;
    startingAfter = res.data[res.data.length - 1].id;
  }
  return out;
}

export function registerAlacarteBillingRoutes(app: Express, deps: AlacarteBillingDeps) {
  void alacarteSchemaReady().catch(() => {});

  // This account's à la carte items, the tier it pays now, and what its plans already cover (so the cards say "Included").
  app.get("/api/alacarte/me", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      res.setHeader("Cache-Control", "no-store");
      if (!user) return res.json({ signedIn: false, tier: "standalone", crmPlanActive: false, isPlatformAdmin: false, items: [], covered: [] });
      const [rows, account] = await Promise.all([alacarteSubscriptionRows(user.id), alacarteAccountOf(user.id)]);
      const ent = account.entitlements;
      const have = { modules: ent.modules, allowances: ent.allowances, addons: ent.addons, alacarte: activeKeysOf(rows) };
      res.json({
        signedIn: true,
        tier: alacarteTierFor(account),
        plan: account.plan, crmPlan: account.crmPlan, crmPlanActive: account.crmPlanActive,
        isPlatformAdmin: ent.isPlatformAdmin,
        items: rows.map(alacarteRowSummary),
        // Items the account's plan (or a held add-on) already gives — nothing to buy.
        covered: ent.isPlatformAdmin ? [...ALACARTE_KEYS] : ALACARTE_KEYS.filter((k) => !have.alacarte.includes(k) && alacarteAlreadyCovered(k, have)),
      });
    } catch (err: any) {
      deps.sendStripeError(res, err);
    }
  });

  app.post("/api/alacarte/checkout", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const order = parseAlacarteOrder(req.body ?? {});
      const it = ALACARTE[order.key];
      const [account, rows] = await Promise.all([alacarteAccountOf(user.id), alacarteSubscriptionRows(user.id)]);
      const ent = account.entitlements;
      if (ent.isPlatformAdmin) {
        return res.status(400).json({ message: `Your account already includes ${it.name} — no payment needed.` });
      }
      if (it.requiresCrmPlan && !account.crmPlanActive) {
        throw new BillingRequestError(409,
          `${it.name} is sold on top of a CRM plan today (from $${CRM_PLANS.crm_basic.monthlyCents / 100}/mo): choose a CRM plan first, then add ${it.name}. Stand-alone ${it.name} is coming.`,
          "crm_plan_required");
      }
      const have = { modules: ent.modules, allowances: ent.allowances, addons: ent.addons, alacarte: activeKeysOf(rows) };
      if (it.grants.crmJobcam && account.crmJobcam && !have.alacarte.includes(order.key)) {
        throw new BillingRequestError(409, `Your CRM plan already includes ${it.name} — there is nothing to add.`, "already_included");
      }
      if (alacarteAlreadyCovered(order.key, have)) {
        throw new BillingRequestError(409, `Your account already has ${it.name}${have.alacarte.includes(order.key) ? "" : " through your plan"} — there is nothing to add.`, "already_included");
      }
      const tier = alacarteTierFor(account);
      const already = () => new BillingRequestError(409,
        `You already have a ${it.name} subscription. Manage it from Settings → Billing — a second one is never started.`,
        "has_alacarte_subscription");

      const url = await withBillingLock(user.id, async () => {
        const row = await alacarteSubscriptionRow(user.id, order.key);
        if (row?.stripe_subscription_id && LIVE_STATUSES.has(row.status)) throw already();
        const customerId = await deps.getOrCreateCustomer(user.id, user.email);
        // Ask Stripe too: the row can lag the webhook. Only this item's subscriptions count.
        const live = (await listAlacarteSubscriptions(customerId, order.key)).find((s) => LIVE_STATUSES.has(s.status));
        if (live) {
          await applyAlacarteSubscription(live, user.id);
          throw already();
        }
        // One open checkout per item: a session left open in another tab is expired first.
        const open = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 20 });
        for (const stale of open.data) {
          if (stale.mode === "subscription" && isAlacarteCheckoutSession(stale) && stale.metadata?.item === order.key) await stripe.checkout.sessions.expire(stale.id);
        }
        const metadata = orderMetadata(user.id, order, tier);
        const base = appReturnBaseUrl(req);
        // Back to the feature page when bought from it, else to the tab.
        const fromFeature = req.body?.returnTo === "feature";
        const okPath = fromFeature ? `/features/${it.slug}?alacarte_success=${order.key}` : `/pricing?alacarte_success=${order.key}#alacarte`;
        const cancelPath = fromFeature ? `/features/${it.slug}?alacarte_canceled=true` : `/pricing?alacarte_canceled=true#alacarte`;
        // No trial: the item is billed from the first invoice at the tier's price.
        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: "subscription",
          line_items: [{ price: await resolvePriceId(stripe, alacartePriceSpec(order.key, tier, order.interval)), quantity: order.quantity }],
          subscription_data: { metadata },
          success_url: `${base}${okPath}`,
          cancel_url: `${base}${cancelPath}`,
          metadata,
        });
        return session.url;
      });
      res.json({ url, tier, cents: alacartePriceCents(order.key, tier, order.interval) * order.quantity, pricingHref: ALACARTE_PRICING_HREF });
    } catch (err: any) {
      deps.sendStripeError(res, err);
    }
  });
}
