/**
 * Selling the CRM — its own Stripe subscription, apart from the platform plan.
 *
 *   GET  /api/crm/billing/plans         the CRM price book (public)
 *   GET  /api/crm/billing/subscription  this account's CRM subscription
 *   POST /api/crm/billing/checkout      start one (Stripe Checkout, 14-day trial once)
 *   POST /api/crm/billing/change        change plan / interval / extra seats / the JobCam add-on in place
 *
 * One account, one Stripe customer, up to two subscriptions: the platform plan
 * (server/stripe.ts, table `subscriptions`) and the CRM plan (here, table
 * `crm_subscriptions`). A CRM subscription is marked metadata.product = "crm"
 * and is made only of CRM prices; the platform webhook hands every event for
 * one to the handlers below and never writes it to `subscriptions`.
 */
import type Stripe from "stripe";
import type { Express, Request, Response } from "express";
import { pool } from "../db";
import { stripe } from "../billing/client";
import { BillingRequestError } from "../billing/order";
import { LIVE_STATUSES, subscriptionPeriodEnd, withBillingLock } from "../billing/sync";
import { crmPlanPriceSpec, crmSeatPriceSpec, crmAddonPriceSpec, resolvePriceId, roleOfPrice } from "../billing/prices";
import { appReturnBaseUrl, portalReturnBaseUrl } from "../site-context";
import {
  CRM_PLANS, CRM_PLAN_KEYS, CRM_TRIAL_DAYS, CRM_EXTRA_SEAT_MONTHLY_CENTS, CRM_EXTRA_SEAT_ANNUAL_CENTS,
  CRM_EXTRA_SEAT_MAX, CRM_ADDONS, crmAddonAvailableOn, crmPlanHasJobcam, isCrmPlanKey, type CrmPlanKey,
} from "@shared/crm-plans";
import type { BillingInterval } from "@shared/plans";
import {
  crmBillingSchemaReady, crmSubscriptionRow, forgetCrmEntitlements, getCrmEntitlements, type CrmSubscriptionRow,
} from "./entitlements";

export const CRM_PRODUCT = "crm";
export const CRM_CHECKOUT_TYPE = "crm_plan";

/** A Stripe subscription that is the CRM product (ours to handle, never the platform's). */
export function isCrmSubscription(sub: Pick<Stripe.Subscription, "metadata" | "items"> | null | undefined): boolean {
  if (!sub) return false;
  if (sub.metadata?.product === CRM_PRODUCT) return true;
  return (sub.items?.data ?? []).some((item) => roleOfPrice(item.price)?.kind === "crm_plan");
}

export const isCrmCheckoutSession = (session: Pick<Stripe.Checkout.Session, "metadata"> | null | undefined) =>
  session?.metadata?.type === CRM_CHECKOUT_TYPE;

export type CrmOrder = { plan: CrmPlanKey; interval: BillingInterval; extraSeats: number; jobcam: boolean };

/**
 * The order a request asks for. `fallback` is the current subscription on a
 * change, so a body that names one thing leaves the rest as it is.
 *
 * The JobCam add-on ($39/mo, shared/crm-plans.ts) is sold on the plans that do
 * not include JobCam. Asking for it on a plan that includes it is refused; a
 * subscription that already carries it and moves to such a plan simply drops
 * the line (the plan now covers it — the buyer must not pay twice).
 */
export function parseCrmOrder(body: any, fallback?: Partial<CrmOrder>): CrmOrder {
  const plan = body?.plan ?? fallback?.plan;
  if (!isCrmPlanKey(plan)) {
    throw new BillingRequestError(400, `Choose a CRM plan: ${CRM_PLAN_KEYS.map((k) => CRM_PLANS[k].name).join(", ")}.`, "unknown_plan");
  }
  const rawInterval = body?.interval ?? fallback?.interval ?? "month";
  if (rawInterval !== "month" && rawInterval !== "year") {
    throw new BillingRequestError(400, "Billing is monthly or yearly.", "unknown_interval");
  }
  const rawSeats = body?.extraSeats ?? fallback?.extraSeats ?? 0;
  if (typeof rawSeats !== "number" || !Number.isInteger(rawSeats) || rawSeats < 0) {
    throw new BillingRequestError(400, "Extra seats must be a whole number, 0 or more.", "bad_quantity");
  }
  if (rawSeats > CRM_EXTRA_SEAT_MAX) {
    throw new BillingRequestError(409, `For more than ${CRM_EXTRA_SEAT_MAX} extra seats, talk to a sales rep.`, "talk_to_sales");
  }
  const asked = body?.jobcam;
  if (asked !== undefined && typeof asked !== "boolean") {
    throw new BillingRequestError(400, "The JobCam add-on is either on or off.", "bad_addon");
  }
  if (asked === true && !crmAddonAvailableOn("jobcam", plan)) {
    throw new BillingRequestError(400, `JobCam is already included in ${CRM_PLANS[plan].name} — there is nothing to add.`, "addon_included");
  }
  const jobcam = (asked ?? fallback?.jobcam ?? false) && crmAddonAvailableOn("jobcam", plan);
  return { plan, interval: rawInterval, extraSeats: rawSeats, jobcam };
}

/** What a CRM Stripe subscription says: plan, interval, extra seats and the items that carry them. */
export function describeCrmSubscription(sub: Stripe.Subscription) {
  let plan: CrmPlanKey | null = null, interval: BillingInterval | null = null, extraSeats = 0;
  let planItem: Stripe.SubscriptionItem | null = null, seatItem: Stripe.SubscriptionItem | null = null;
  let jobcamItem: Stripe.SubscriptionItem | null = null;
  for (const item of sub.items?.data ?? []) {
    const role = roleOfPrice(item.price);
    if (role?.kind === "crm_plan" && !planItem) { plan = role.key; interval = role.interval; planItem = item; }
    else if (role?.kind === "crm_seat" && !seatItem) { seatItem = item; extraSeats = item.quantity ?? 0; }
    else if (role?.kind === "crm_addon" && role.key === "jobcam" && !jobcamItem) { jobcamItem = item; }
  }
  return { plan, interval, extraSeats, jobcam: !!jobcamItem, planItem, seatItem, jobcamItem };
}

/**
 * Record a CRM Stripe subscription on the account's row (insert or update).
 * `userId` comes from our own metadata; an event without it is matched by the
 * subscription id, then by the Stripe customer. Returns the account, or null
 * when the subscription can't be tied to one.
 */
export async function applyCrmSubscription(sub: Stripe.Subscription, hintUserId?: number | null): Promise<number | null> {
  await crmBillingSchemaReady();
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  let userId = hintUserId || parseInt(sub.metadata?.userId || "0") || null;
  if (!userId) {
    const { rows: [bySub] } = await pool.query(`SELECT user_id FROM crm_subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`, [sub.id]);
    userId = bySub?.user_id ?? null;
  }
  if (!userId && customerId) {
    const { rows: [byCustomer] } = await pool.query(`SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1`, [customerId]);
    userId = byCustomer?.user_id ?? null;
  }
  if (!userId) {
    console.error(`[crm-billing] subscription ${sub.id} has no account (no userId metadata, unknown customer ${customerId}).`);
    return null;
  }

  // The row tracks ONE subscription: a late event for an older, ended one must
  // not overwrite the live one.
  const existing = await crmSubscriptionRow(userId);
  if (existing?.stripe_subscription_id && existing.stripe_subscription_id !== sub.id
      && LIVE_STATUSES.has(existing.status) && !LIVE_STATUSES.has(sub.status)) {
    return userId;
  }

  const shape = describeCrmSubscription(sub);
  const ended = !LIVE_STATUSES.has(sub.status);
  const trialEnd = typeof sub.trial_end === "number" ? new Date(sub.trial_end * 1000) : null;
  await pool.query(
    `INSERT INTO crm_subscriptions
       (user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan, status, billing_interval,
        extra_seats, current_period_end, trial_end, cancel_at_period_end, jobcam_addon, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     ON CONFLICT (user_id) DO UPDATE SET
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       stripe_price_id = EXCLUDED.stripe_price_id,
       plan = EXCLUDED.plan,
       status = EXCLUDED.status,
       billing_interval = EXCLUDED.billing_interval,
       extra_seats = EXCLUDED.extra_seats,
       current_period_end = EXCLUDED.current_period_end,
       trial_end = EXCLUDED.trial_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       jobcam_addon = EXCLUDED.jobcam_addon,
       updated_at = now()`,
    [
      userId, customerId, sub.id, shape.planItem?.price.id ?? null,
      ended ? null : shape.plan, sub.status, shape.interval,
      ended ? 0 : shape.extraSeats, subscriptionPeriodEnd(sub), trialEnd,
      Boolean(sub.cancel_at_period_end || sub.cancel_at),
      !ended && shape.jobcam,
    ],
  );
  forgetCrmEntitlements(userId);
  return userId;
}

/** The tracked CRM subscription ended: the row keeps its history (so no second trial) and loses the plan. */
export async function endCrmSubscription(sub: Stripe.Subscription): Promise<number | null> {
  await crmBillingSchemaReady();
  const { rows: [row] } = await pool.query(
    `UPDATE crm_subscriptions SET status = 'canceled', plan = NULL, extra_seats = 0, jobcam_addon = false, cancel_at_period_end = NULL, updated_at = now()
      WHERE stripe_subscription_id = $1 RETURNING user_id`, [sub.id]);
  forgetCrmEntitlements(row?.user_id);
  return row?.user_id ?? null;
}

function summary(row: CrmSubscriptionRow | undefined) {
  const plan = row && isCrmPlanKey(row.plan) ? row.plan : null;
  return {
    plan,
    planName: plan ? CRM_PLANS[plan].name : null,
    status: row?.status ?? "inactive",
    interval: row?.billing_interval ?? null,
    extraSeats: row?.extra_seats ?? 0,
    seats: plan ? CRM_PLANS[plan].limits.seats + (row?.extra_seats ?? 0) : 0,
    jobcamAddon: !!plan && row?.jobcam_addon === true && crmAddonAvailableOn("jobcam", plan),
    /** JobCam on this subscription: included by the plan or bought as the add-on. */
    jobcam: crmPlanHasJobcam(plan, row?.jobcam_addon === true),
    currentPeriodEnd: row?.current_period_end ?? null,
    trialEndsAt: row?.status === "trialing" ? row?.trial_end ?? null : null,
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    hasLiveSubscription: Boolean(row?.stripe_subscription_id && LIVE_STATUSES.has(row.status)),
  };
}

/** GET /api/crm/billing/plans — the CRM price book, straight from shared/crm-plans.ts. */
export function crmPriceBook() {
  return {
    currency: "usd",
    plans: CRM_PLAN_KEYS.map((key) => CRM_PLANS[key]),
    extraSeat: { monthlyCents: CRM_EXTRA_SEAT_MONTHLY_CENTS, annualCents: CRM_EXTRA_SEAT_ANNUAL_CENTS, max: CRM_EXTRA_SEAT_MAX },
    addons: Object.values(CRM_ADDONS),
    trialDays: CRM_TRIAL_DAYS,
  };
}

export type CrmBillingDeps = {
  /** The account's Stripe customer (created once; shared with the platform plan). */
  getOrCreateCustomer: (userId: number, email: string) => Promise<string>;
  sendStripeError: (res: Response, err: any) => unknown;
  /** Step-up before a change that charges the saved card. */
  recentAuthOk: (req: Request, res: Response) => Promise<boolean>;
};

export async function lineItemsFor(order: CrmOrder) {
  const items: { price: string; quantity: number }[] = [
    { price: await resolvePriceId(stripe, crmPlanPriceSpec(order.plan, order.interval)), quantity: 1 },
  ];
  if (order.extraSeats > 0) {
    items.push({ price: await resolvePriceId(stripe, crmSeatPriceSpec(order.interval)), quantity: order.extraSeats });
  }
  if (order.jobcam) {
    items.push({ price: await resolvePriceId(stripe, crmAddonPriceSpec("jobcam", order.interval)), quantity: 1 });
  }
  return items;
}

const orderMetadata = (userId: number, order: CrmOrder) => ({
  userId: String(userId), type: CRM_CHECKOUT_TYPE, product: CRM_PRODUCT,
  plan: order.plan, interval: order.interval, extraSeats: String(order.extraSeats), jobcam: order.jobcam ? "1" : "0",
});

type CrmCurrent = ReturnType<typeof describeCrmSubscription>;

/**
 * The subscription-item edits that turn `current` into `order`: plan, extra
 * seats and the JobCam add-on, each added, re-priced (an interval change moves
 * every line to the other interval's price) or removed. Stripe is reached only
 * through `priceId`, so billing-jobcam.test.ts drives it with a double.
 */
export async function crmChangeItems(
  current: Pick<CrmCurrent, "planItem" | "seatItem" | "jobcamItem" | "extraSeats">,
  order: CrmOrder,
  priceId: (spec: ReturnType<typeof crmPlanPriceSpec>) => Promise<string>,
): Promise<Stripe.SubscriptionUpdateParams.Item[]> {
  const items: Stripe.SubscriptionUpdateParams.Item[] = [];
  const planPrice = await priceId(crmPlanPriceSpec(order.plan, order.interval));
  if (current.planItem) {
    if (current.planItem.price.id !== planPrice) items.push({ id: current.planItem.id, price: planPrice, quantity: 1 });
  } else {
    items.push({ price: planPrice, quantity: 1 });
  }
  if (current.seatItem) {
    if (order.extraSeats === 0) items.push({ id: current.seatItem.id, deleted: true });
    else {
      const seatPrice = await priceId(crmSeatPriceSpec(order.interval));
      if (current.seatItem.price.id !== seatPrice || current.extraSeats !== order.extraSeats) {
        items.push({ id: current.seatItem.id, price: seatPrice, quantity: order.extraSeats });
      }
    }
  } else if (order.extraSeats > 0) {
    items.push({ price: await priceId(crmSeatPriceSpec(order.interval)), quantity: order.extraSeats });
  }
  if (current.jobcamItem) {
    if (!order.jobcam) items.push({ id: current.jobcamItem.id, deleted: true });
    else {
      const jobcamPrice = await priceId(crmAddonPriceSpec("jobcam", order.interval));
      if (current.jobcamItem.price.id !== jobcamPrice) items.push({ id: current.jobcamItem.id, price: jobcamPrice, quantity: 1 });
    }
  } else if (order.jobcam) {
    items.push({ price: await priceId(crmAddonPriceSpec("jobcam", order.interval)), quantity: 1 });
  }
  return items;
}

export function registerCrmBillingRoutes(app: Express, deps: CrmBillingDeps) {
  void crmBillingSchemaReady();

  app.get("/api/crm/billing/plans", (_req, res) => res.json(crmPriceBook()));

  app.get("/api/crm/billing/subscription", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const [row, ent] = await Promise.all([crmSubscriptionRow(user.id), getCrmEntitlements(user.id, { fresh: true })]);
      res.json({ ...summary(row), access: { active: ent.active, via: ent.via } });
    } catch (err: any) {
      deps.sendStripeError(res, err);
    }
  });

  app.post("/api/crm/billing/checkout", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const ent = await getCrmEntitlements(user.id, { fresh: true });
      if (ent.via === "beta" || ent.via === "admin") {
        return res.status(400).json({ message: "Your account already includes the CRM — no payment needed." });
      }
      const order = parseCrmOrder(req.body ?? {});
      const already = () => new BillingRequestError(409,
        "You already have a CRM subscription. Change its plan or seats from Pricing — that updates it in place instead of starting a second one.",
        "has_crm_subscription");

      const url = await withBillingLock(user.id, async () => {
        const row = await crmSubscriptionRow(user.id);
        if (row?.stripe_subscription_id && LIVE_STATUSES.has(row.status)) throw already();

        const customerId = await deps.getOrCreateCustomer(user.id, user.email);
        // Ask Stripe too: the row can lag the webhook. Only CRM subscriptions
        // count — the platform plan is a different subscription on this customer.
        const history = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 30 });
        const crmHistory = history.data.filter((s) => isCrmSubscription(s));
        const live = crmHistory.find((s) => LIVE_STATUSES.has(s.status));
        if (live) {
          await applyCrmSubscription(live, user.id);
          throw already();
        }
        // One trial per account: only someone who never had a CRM subscription.
        const trial = !row?.stripe_subscription_id && crmHistory.length === 0;

        const open = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 10 });
        for (const stale of open.data) {
          if (stale.mode === "subscription" && isCrmCheckoutSession(stale)) await stripe.checkout.sessions.expire(stale.id);
        }

        const metadata = orderMetadata(user.id, order);
        // Bought from inside the CRM app (the portal host) or from the pricing
        // page (the app host): back to the same place, where they are signed in.
        const fromCrm = req.body?.returnTo === "crm";
        const base = fromCrm ? portalReturnBaseUrl(req) : appReturnBaseUrl(req);
        const [okPath, cancelPath] = fromCrm
          ? ["/crm?crm_success=true", "/crm?crm_canceled=true"]
          : ["/pricing?crm_success=true#crm", "/pricing?crm_canceled=true#crm"];
        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: "subscription",
          line_items: await lineItemsFor(order),
          subscription_data: { ...(trial ? { trial_period_days: CRM_TRIAL_DAYS } : {}), metadata },
          success_url: `${base}${okPath}`,
          cancel_url: `${base}${cancelPath}`,
          metadata,
        });
        return session.url;
      });
      res.json({ url });
    } catch (err: any) {
      deps.sendStripeError(res, err);
    }
  });

  app.post("/api/crm/billing/change", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      if (!(await deps.recentAuthOk(req, res))) return;

      const result = await withBillingLock(user.id, async () => {
        const row = await crmSubscriptionRow(user.id);
        if (!row?.stripe_subscription_id || !LIVE_STATUSES.has(row.status)) {
          throw new BillingRequestError(409, "You don't have a CRM subscription to change. Choose a CRM plan in Pricing to start one.", "no_crm_subscription");
        }
        const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
        if (!LIVE_STATUSES.has(sub.status)) {
          await applyCrmSubscription(sub, user.id);
          throw new BillingRequestError(409, "Your CRM subscription has ended. Choose a CRM plan in Pricing to start a new one.", "no_crm_subscription");
        }
        const current = describeCrmSubscription(sub);
        const order = parseCrmOrder(req.body ?? {}, {
          plan: current.plan ?? undefined, interval: current.interval ?? undefined, extraSeats: current.extraSeats, jobcam: current.jobcam,
        });
        if (current.plan === order.plan && current.interval === order.interval && current.extraSeats === order.extraSeats && current.jobcam === order.jobcam) {
          return { changed: false, subscription: summary(row) };
        }

        const items = await crmChangeItems(current, order, (spec) => resolvePriceId(stripe, spec));

        const updated = await stripe.subscriptions.update(sub.id, {
          items,
          proration_behavior: "always_invoice",
          payment_behavior: "error_if_incomplete",
          metadata: orderMetadata(user.id, order),
        });
        await applyCrmSubscription(updated, user.id);
        return { changed: true, subscription: summary(await crmSubscriptionRow(user.id)) };
      });
      res.json(result);
    } catch (err: any) {
      deps.sendStripeError(res, err);
    }
  });
}
