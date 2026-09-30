import type Stripe from "stripe";
import type { Express, Request, Response } from "express";
import { db } from "./db";
import { subscriptions, masterClassModules, coursePurchases, servicePurchases } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getBaseUrl } from "./auth";
import { DFY_CATALOG, COURSE_BUNDLE, SEO_CONTRACT_REQUIRED_IDS, isSalesOnly, sendTalkToSales } from "./catalog";
import { bundleOverlaps, BUNDLE_NAMES } from "@shared/cart-bundles";
import {
  PLANS as PRICE_BOOK, PLAN_KEYS, ADDON_KEYS, ADDONS, AGENCY_LOCATION_BANDS, AGENCY_SELF_SERVE_MAX_LOCATIONS,
  ANNUAL_MONTHS, TRIAL_DAYS, SALES_THRESHOLD_CENTS,
} from "@shared/plans";
import { stripe, PaymentsNotConfiguredError } from "./billing/client";
import { describeSubscription } from "./billing/prices";
import {
  BillingRequestError, parsePlanOrder, parsePlanKey, parseInterval, parseAddonQuantities, checkAddonsForPlan,
  checkoutLineItems, subscriptionChange, type PlanOrder,
} from "./billing/order";
import {
  billingSchemaReady, hasLiveStripeSubscription, trialEligible, eventAppliesToRow, subscriptionRowUpdate,
  canceledRowUpdate, subscriptionSummary, LIVE_STATUSES, recordCancellation, cancellationFor, cancellationOf,
  withBillingLock,
} from "./billing/sync";
import { startAgencyLocationSync } from "./billing/agency-sync";

export { PaymentsNotConfiguredError };

/**
 * A checkout/portal route's catch: the not-configured case as an honest 503,
 * a request the price book can't sell as its own status + code, a declined
 * card as 402 payment_failed, anything else as before.
 */
function sendStripeError(res: Response, err: any) {
  if (err instanceof PaymentsNotConfiguredError) {
    return res.status(err.status).json({ message: err.message });
  }
  if (err instanceof BillingRequestError) {
    return res.status(err.status).json(err.code ? { code: err.code, message: err.message } : { message: err.message });
  }
  if (err?.type === "StripeCardError" || err?.statusCode === 402) {
    return res.status(402).json({
      code: "payment_failed",
      message: `Your card couldn't be charged, so nothing changed${err?.message ? ` (${err.message})` : ""}. Update your card in Manage billing and try again.`,
    });
  }
  return res.status(500).json({ message: err?.message });
}

// Plan limits are read through getEntitlements() (server/entitlements.ts) —
// quotas, CRM seats and module gates alike. This file only sells the plans.

/** GET /api/stripe/plans — the price book, straight from shared/plans.ts. */
export function priceBook() {
  return {
    currency: "usd",
    plans: PLAN_KEYS.map((key) => PRICE_BOOK[key]),
    addons: ADDON_KEYS.map((key) => ADDONS[key]),
    agency: {
      includedLocations: PRICE_BOOK.agency.limits.locations,
      bands: AGENCY_LOCATION_BANDS,
      selfServeMaxLocations: AGENCY_SELF_SERVE_MAX_LOCATIONS,
    },
    trialDays: TRIAL_DAYS,
    annualMonths: ANNUAL_MONTHS,
    salesThresholdCents: SALES_THRESHOLD_CENTS,
  };
}

type SubscriptionRow = typeof subscriptions.$inferSelect;

async function subscriptionRowFor(userId: number): Promise<SubscriptionRow | undefined> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  return row;
}

async function getOrCreateCustomer(userId: number, email: string, existing?: SubscriptionRow | null) {
  if (existing === undefined) existing = await subscriptionRowFor(userId);

  if (existing?.stripeCustomerId) {
    return existing.stripeCustomerId;
  }

  const customer = await stripe.customers.create({ email, metadata: { userId: String(userId) } });

  if (existing) {
    await db.update(subscriptions).set({ stripeCustomerId: customer.id }).where(eq(subscriptions.id, existing.id));
  } else {
    await db.insert(subscriptions).values({
      userId,
      stripeCustomerId: customer.id,
      plan: "free",
      status: "inactive",
    });
  }

  return customer.id;
}

const orderMetadata = (userId: number, order: PlanOrder) => ({
  userId: String(userId),
  type: "plan",
  plan: order.plan,
  interval: order.interval,
  addons: JSON.stringify(order.addons),
  locations: order.agencyLocations === null ? "" : String(order.agencyLocations),
});

const NO_SUBSCRIPTION = () => new BillingRequestError(409,
  "You don't have an active subscription to change. Choose a plan in Pricing to start one.", "no_subscription");

/** create-checkout for someone who already has a live subscription: change it instead, never a second one. */
const hasSubscription = (status: string) => new BillingRequestError(409,
  ["past_due", "unpaid", "incomplete"].includes(status)
    ? "Your subscription has a payment that needs attention. Open Manage billing to update your card — a second subscription is never started."
    : "You already have a subscription. Change your plan or add-ons from Pricing — that updates it in place instead of starting a second one.",
  "has_subscription");

/** The user's live Stripe subscription (for change-plan / add-ons), or a 409. */
async function liveSubscription(userId: number) {
  const row = await subscriptionRowFor(userId);
  if (!row || !hasLiveStripeSubscription(row)) throw NO_SUBSCRIPTION();
  const sub = await stripe.subscriptions.retrieve(row.stripeSubscriptionId!);
  if (!LIVE_STATUSES.has(sub.status)) {
    // The row missed the webhook that ended it. Record what Stripe says, so
    // create-checkout stops answering has_subscription and the customer can
    // start a new plan instead of being refused by both routes.
    await writeSubscriptionRow({ id: row.id }, sub);
    throw NO_SUBSCRIPTION();
  }
  return { row, sub, current: describeSubscription(sub.items.data) };
}

/** Record a Stripe subscription on the row: the drizzle columns, then its cancellation state (plain-SQL columns). */
async function writeSubscriptionRow(where: { id: number } | { userId: number }, sub: Stripe.Subscription, fallbackPlan?: string | null) {
  const set = subscriptionRowUpdate(sub, fallbackPlan);
  await db.update(subscriptions).set(set)
    .where("id" in where ? eq(subscriptions.id, where.id) : eq(subscriptions.userId, where.userId));
  await recordCancellation(where, sub);
  return set;
}

/**
 * Apply an order to the EXISTING subscription: items are repriced/requantified
 * in place with proration, invoiced immediately; if the card can't pay, Stripe
 * rejects the update and nothing changes (error_if_incomplete).
 */
async function applyToSubscription(userId: number, row: SubscriptionRow, sub: Stripe.Subscription, current: ReturnType<typeof describeSubscription>, order: PlanOrder) {
  const change = await subscriptionChange(stripe, current, order);
  if (!change.items.length && !change.addInvoiceItems.length) {
    return { changed: false, subscription: subscriptionSummary(row, cancellationOf(sub)) };
  }
  const updated = await stripe.subscriptions.update(sub.id, {
    items: change.items,
    ...(change.addInvoiceItems.length ? { add_invoice_items: change.addInvoiceItems } : {}),
    proration_behavior: "always_invoice",
    payment_behavior: "error_if_incomplete",
    metadata: { userId: String(userId), plan: order.plan, interval: order.interval },
  });
  const set = await writeSubscriptionRow({ id: row.id }, updated);
  return { changed: true, subscription: subscriptionSummary({ ...row, ...set } as SubscriptionRow, cancellationOf(updated)) };
}

/** Step-up: plan and add-on changes charge the saved card without a Stripe page. */
async function recentAuthOk(req: Request, res: Response): Promise<boolean> {
  const { requireRecentAuth } = await import("./account-security");
  return requireRecentAuth(req, res);
}

export function registerStripeRoutes(app: Express) {
  // Boot: add the billing columns before anything reads `subscriptions`, and
  // schedule the daily Agency location sync (off without a Stripe key).
  void billingSchemaReady();
  startAgencyLocationSync();

  app.get("/api/stripe/plans", (_req: Request, res: Response) => {
    res.json(priceBook());
  });

  app.get("/api/stripe/subscription", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.json(subscriptionSummary(null));
      await billingSchemaReady();
      const row = await subscriptionRowFor(user.id);
      res.json(subscriptionSummary(row, row?.stripeSubscriptionId ? await cancellationFor(row.id) : null));
    } catch (err: any) {
      sendStripeError(res, err);
    }
  });

  /**
   * New subscription: { plan, interval: "month"|"year", addons?: { key: qty }, locations? (Agency) }.
   * Prices come only from shared/plans.ts. Someone already subscribed is sent
   * to change-plan instead — a second subscription is never started.
   */
  app.post("/api/stripe/create-checkout", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      // Beta accounts get the CRM free for the duration of the beta — never
      // send one to a card form.
      const { isBetaUser } = await import("./crm/beta");
      if (await isBetaUser(user.id)) {
        return res.status(400).json({ message: "Your account is included in the beta — no payment needed." });
      }

      const order = parsePlanOrder(req.body ?? {});
      await billingSchemaReady();
      // One account's checkout starts one at a time (a double click or a second
      // tab waits here), so the open-checkout sweep below sees the other one.
      const url = await withBillingLock(user.id, async () => {
        const row = await subscriptionRowFor(user.id);
        if (hasLiveStripeSubscription(row)) throw hasSubscription(row!.status);

        const customerId = await getOrCreateCustomer(user.id, user.email, row ?? null);
        // Ask Stripe too: the row can lag the webhook (a checkout just paid in
        // another tab), and a trial code clears the row's subscription id. A
        // live subscription is never joined by a second one, and the 1-day
        // trial is for a customer who never had a subscription.
        let trial = trialEligible(row);
        if (row?.stripeCustomerId) {
          const history = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
          const live = history.data.find((s) => LIVE_STATUSES.has(s.status));
          if (live) {
            // Record it (as the webhook will), so the account gets what it pays
            // for now and Pricing can change that subscription in place.
            await writeSubscriptionRow({ id: row.id }, live);
            throw hasSubscription(live.status);
          }
          if (history.data.length) trial = false;
        }

        const line_items = await checkoutLineItems(stripe, order);
        // One open plan checkout per customer: a checkout left open in another
        // tab is expired first, so finishing both can't start two subscriptions.
        const open = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 10 });
        for (const stale of open.data) {
          if (stale.mode === "subscription") await stripe.checkout.sessions.expire(stale.id);
        }
        const metadata = orderMetadata(user.id, order);

        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: "subscription",
          line_items,
          subscription_data: {
            ...(trial ? { trial_period_days: TRIAL_DAYS } : {}),
            metadata,
          },
          success_url: `${getBaseUrl(req)}/pricing?success=true`,
          cancel_url: `${getBaseUrl(req)}/pricing?canceled=true`,
          metadata,
        });
        return session.url;
      });

      res.json({ url });
    } catch (err: any) {
      sendStripeError(res, err);
    }
  });

  /**
   * Existing subscriber switches plan / interval / Agency locations (and may
   * set add-on quantities in the same call). Updates the one subscription.
   */
  app.post("/api/stripe/change-plan", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      // Cheap validation before any Stripe call or step-up prompt.
      parsePlanKey(req.body?.plan);
      parseInterval(req.body?.interval);
      parseAddonQuantities(req.body?.addons);
      if (!(await recentAuthOk(req, res))) return;

      await billingSchemaReady();
      res.json(await withBillingLock(user.id, async () => {
        const { row, sub, current } = await liveSubscription(user.id);
        const order = parsePlanOrder(req.body ?? {}, {
          interval: current.interval,
          addons: current.addons,
          agencyLocations: current.plan === "agency" ? PRICE_BOOK.agency.limits.locations + current.agencyExtraLocations : null,
        });
        return applyToSubscription(user.id, row, sub, current, order);
      }));
    } catch (err: any) {
      sendStripeError(res, err);
    }
  });

  /**
   * Existing subscriber sets add-on quantities on the current plan (0 removes):
   * { addons: { key: qty } }, or one add-on as { addon: key, quantity: qty }
   * (the shape the Settings billing card sends).
   */
  app.post("/api/stripe/addons", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });
      const single = req.body?.addons === undefined && req.body?.addon !== undefined;
      const requested = parseAddonQuantities(single ? { [String(req.body.addon)]: req.body.quantity } : req.body?.addons);
      if (!Object.keys(requested).length) {
        return res.status(400).json({ message: "Choose an add-on quantity to change." });
      }
      if (!(await recentAuthOk(req, res))) return;

      await billingSchemaReady();
      res.json(await withBillingLock(user.id, async () => {
        const { row, sub, current } = await liveSubscription(user.id);
        if (!current.plan || !current.interval) {
          throw new BillingRequestError(409,
            "Your subscription is on an older plan. Switch to a current plan first (Change plan), then add add-ons.", "legacy_plan");
        }
        const addons = Object.fromEntries(
          Object.entries({ ...current.addons, ...requested }).filter(([, qty]) => (qty ?? 0) > 0));
        checkAddonsForPlan(current.plan, addons);
        const order: PlanOrder = {
          plan: current.plan,
          interval: current.interval,
          addons,
          agencyLocations: current.plan === "agency" ? PRICE_BOOK.agency.limits.locations + current.agencyExtraLocations : null,
        };
        return applyToSubscription(user.id, row, sub, current, order);
      }));
    } catch (err: any) {
      sendStripeError(res, err);
    }
  });

  app.post("/api/stripe/create-portal", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      await billingSchemaReady();
      const sub = await subscriptionRowFor(user.id);

      if (!sub?.stripeCustomerId) {
        return res.status(400).json({ message: "No subscription found" });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: `${getBaseUrl(req)}/pricing`,
      });

      res.json({ url: session.url });
    } catch (err: any) {
      sendStripeError(res, err);
    }
  });

  app.post("/api/stripe/create-course-checkout", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      const { moduleId, bundle } = req.body;

      if (bundle) {
        if (isSalesOnly(COURSE_BUNDLE.priceCents)) return sendTalkToSales(res, [COURSE_BUNDLE.name]);
        const allModules = await db.select().from(masterClassModules).where(eq(masterClassModules.isActive, true));
        await billingSchemaReady();
        const customerId = await getOrCreateCustomer(user.id, user.email);

        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: `ConstructHUB ${COURSE_BUNDLE.name}`,
                  description: allModules.map(m => m.title).join(", "),
                },
                unit_amount: COURSE_BUNDLE.priceCents,
              },
              quantity: 1,
            },
          ],
          success_url: `${getBaseUrl(req)}/master-class?success=true`,
          cancel_url: `${getBaseUrl(req)}/master-class?canceled=true`,
          metadata: { userId: String(user.id), type: "master_class", bundle: "true" },
        });

        return res.json({ url: session.url });
      }

      if (!moduleId) return res.status(400).json({ message: "moduleId or bundle required" });

      const [mod] = await db.select().from(masterClassModules).where(eq(masterClassModules.id, moduleId)).limit(1);
      if (!mod) return res.status(404).json({ message: "Module not found" });
      if (isSalesOnly(mod.price)) return sendTalkToSales(res, [`Master Class — ${mod.title}`]);

      await billingSchemaReady();
      const customerId = await getOrCreateCustomer(user.id, user.email);

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `ConstructHUB Master Class — ${mod.title}`,
                description: mod.description,
              },
              unit_amount: mod.price,
            },
            quantity: 1,
          },
        ],
        success_url: `${getBaseUrl(req)}/master-class?success=true`,
        cancel_url: `${getBaseUrl(req)}/master-class?canceled=true`,
        metadata: { userId: String(user.id), type: "master_class", moduleId: String(mod.id) },
      });

      res.json({ url: session.url });
    } catch (err: any) {
      sendStripeError(res, err);
    }
  });

  app.post("/api/stripe/create-cart-checkout", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      const { items } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }

      // SECURITY: resolve every price and name server-side from the catalog / DB.
      // The client-supplied item.price and item.name are never trusted.
      const resolved: { id: string; type: string; name: string; price: number; moduleId: number | null }[] = [];
      for (const item of items) {
        const type = String(item?.type ?? "");
        if (type === "course_module") {
          const moduleId = Number(item?.moduleId);
          if (!Number.isInteger(moduleId)) {
            return res.status(400).json({ message: "Invalid course module in cart" });
          }
          const [mod] = await db.select().from(masterClassModules).where(eq(masterClassModules.id, moduleId)).limit(1);
          if (!mod) return res.status(400).json({ message: `Unknown course module: ${moduleId}` });
          resolved.push({ id: `course_module_${moduleId}`, type, name: `Master Class — ${mod.title}`, price: mod.price, moduleId });
        } else if (type === "course_bundle") {
          resolved.push({ id: "course_bundle", type, name: COURSE_BUNDLE.name, price: COURSE_BUNDLE.priceCents, moduleId: null });
        } else if (type === "dfy_service" || type === "dfy_bundle") {
          const entry = DFY_CATALOG[String(item?.id ?? "")];
          if (!entry) return res.status(400).json({ message: `Unknown service: ${item?.id}` });
          resolved.push({ id: String(item.id), type, name: entry.name, price: entry.priceCents, moduleId: null });
        } else {
          return res.status(400).json({ message: `Unsupported cart item type: ${type}` });
        }
      }

      // $1,000 and up is quoted by a sales rep — never a checkout (priced here,
      // on the server-resolved amount, so a forged cart price can't slip under).
      const salesOnly = resolved.filter((item) => isSalesOnly(item.price));
      if (salesOnly.length) return sendTalkToSales(res, [...new Set(salesOnly.map((item) => item.name))]);

      if (resolved.some((item) => SEO_CONTRACT_REQUIRED_IDS.has(item.id))) {
        return res.status(400).json({ message: "SEO packages require a signed contract before payment. Please use the contract checkout flow." });
      }

      // One charge per thing bought. Checked on the server-resolved items (ids
      // are canonical here), so a crafted or stale cart can't pay twice for a
      // service: not the same item twice, and not a bundle plus a part of it.
      if (new Set(resolved.map((item) => item.id)).size !== resolved.length) {
        return res.status(400).json({ message: "Your cart lists the same item more than once. Remove the duplicate before checkout." });
      }
      const overlap = bundleOverlaps(resolved);
      if (overlap.length) {
        return res.status(400).json({
          message: `Your cart has the ${BUNDLE_NAMES[overlap[0].bundleId]} plus items it already includes (${overlap.map((o) => o.part.name).join(", ")}). Remove them before checkout.`,
        });
      }

      await billingSchemaReady();
      const customerId = await getOrCreateCustomer(user.id, user.email);

      const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = resolved.map((item) => ({
        price_data: {
          currency: "usd",
          product_data: { name: item.name },
          unit_amount: item.price,
        },
        quantity: 1,
      }));

      const itemsMeta = resolved.map((item) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        price: item.price,
        moduleId: item.moduleId,
      }));

      const totalAmount = resolved.reduce((sum, item) => sum + item.price, 0);
      const isHighTicket = totalAmount >= 500000;

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        customer: customerId,
        mode: "payment",
        line_items,
        success_url: `${getBaseUrl(req)}/pricing?cart_success=true`,
        cancel_url: `${getBaseUrl(req)}/pricing?cart_canceled=true`,
        metadata: {
          userId: String(user.id),
          type: "cart",
          items: JSON.stringify(itemsMeta),
        },
      };

      if (isHighTicket) {
        sessionParams.payment_method_types = ["card", "us_bank_account"];
        sessionParams.payment_method_options = {
          us_bank_account: {
            financial_connections: { permissions: ["payment_method"] },
          },
        };
      }

      const session = await stripe.checkout.sessions.create(sessionParams);

      res.json({ url: session.url });
    } catch (err: any) {
      sendStripeError(res, err);
    }
  });

  app.post("/api/stripe/webhook", async (req: Request, res: Response) => {
    try {
      const sig = req.headers["stripe-signature"] as string | undefined;
      const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

      // Fail closed: never trust an unsigned/unverified body. A missing secret
      // is a misconfiguration, not a reason to accept forged events.
      if (!endpointSecret) {
        console.error("STRIPE_WEBHOOK_SECRET is not set — rejecting webhook.");
        return res.status(500).json({ message: "Webhook not configured" });
      }
      if (!sig) {
        return res.status(400).json({ message: "Missing stripe-signature header" });
      }

      // constructEvent requires the raw request bytes; server/index.ts captures
      // them as req.rawBody via the express.json verify hook. Using the parsed
      // body here would make signature verification always throw.
      const rawBody = (req as any).rawBody as Buffer | undefined;
      if (!rawBody) {
        console.error("req.rawBody missing — cannot verify Stripe signature.");
        return res.status(500).json({ message: "Webhook body unavailable" });
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
      } catch (verifyErr: any) {
        console.error("Stripe signature verification failed:", verifyErr.message);
        return res.status(400).json({ message: `Webhook signature verification failed` });
      }

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = parseInt(session.metadata?.userId || "0");
          const metaType = session.metadata?.type;

          if (userId && metaType === "cart") {
            try {
              const cartItems = JSON.parse(session.metadata?.items || "[]");
              for (const item of cartItems) {
                if (item.type === "course_module" && item.moduleId) {
                  await db.insert(coursePurchases).values({
                    userId,
                    moduleId: item.moduleId,
                    isBundle: false,
                    stripeSessionId: session.id,
                  });
                } else if (item.type === "course_bundle") {
                  await db.insert(coursePurchases).values({
                    userId,
                    moduleId: null,
                    isBundle: true,
                    stripeSessionId: session.id,
                  });
                } else if (item.type === "dfy_service" || item.type === "dfy_bundle") {
                  await db.insert(servicePurchases).values({
                    userId,
                    serviceType: item.id,
                    serviceName: item.name,
                    price: item.price,
                    stripeSessionId: session.id,
                  });
                }
              }
            } catch (e) {
              console.error("Failed to process cart items:", e);
            }
          } else if (userId && metaType === "master_class") {
            const isBundle = session.metadata?.bundle === "true";
            const moduleId = session.metadata?.moduleId ? parseInt(session.metadata.moduleId) : null;
            await db.insert(coursePurchases).values({
              userId,
              moduleId,
              isBundle: isBundle,
              stripeSessionId: session.id,
            });
          } else if (userId && session.subscription) {
            // Plan, interval, add-ons and Agency locations are read from the
            // subscription's items (prices we created), not from metadata.
            await billingSchemaReady();
            const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription as string);
            const [tracked] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
            if (tracked && hasLiveStripeSubscription(tracked) && tracked.stripeSubscriptionId !== stripeSubscription.id) {
              // Checkout refuses live subscribers and expires stale sessions, so
              // this should not happen; if it does, both bill — say so loudly.
              console.error(`[billing] user ${userId} now has two live subscriptions (${tracked.stripeSubscriptionId} and ${stripeSubscription.id}); tracking the new one — cancel the other in Stripe.`);
            }
            await writeSubscriptionRow({ userId }, stripeSubscription, session.metadata?.plan);
          }
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = sub.customer as string;
          await billingSchemaReady();

          const [existingSub] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.stripeCustomerId, customerId))
            .limit(1);

          if (existingSub && eventAppliesToRow(existingSub, sub)) {
            await writeSubscriptionRow({ id: existingSub.id }, sub);
          } else if (existingSub) {
            console.warn(`[billing] ${event.type} for ${sub.id} (${sub.status}) ignored: user ${existingSub.userId} is on ${existingSub.stripeSubscriptionId ?? "a live trial-code grant"}.`);
          }
          break;
        }
        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = sub.customer as string;
          await billingSchemaReady();

          // Only the subscription this account is on ends its plan; ending a
          // stray second subscription must not cancel the one still paid for.
          const [existingSub] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.stripeCustomerId, customerId))
            .limit(1);
          if (existingSub?.stripeSubscriptionId === sub.id) {
            await db
              .update(subscriptions)
              .set(canceledRowUpdate())
              .where(eq(subscriptions.id, existingSub.id));
            await recordCancellation({ id: existingSub.id }, null);
          } else if (existingSub) {
            console.warn(`[billing] deletion of ${sub.id} ignored: user ${existingSub.userId} is on ${existingSub.stripeSubscriptionId ?? "no subscription"}.`);
          }
          break;
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });
}
