import Stripe from "stripe";
import type { Express, Request, Response } from "express";
import { db } from "./db";
import { subscriptions, users, masterClassModules, coursePurchases, servicePurchases } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getBaseUrl } from "./auth";
import { DFY_CATALOG, COURSE_BUNDLE, SEO_CONTRACT_REQUIRED_IDS } from "./catalog";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27.acacia" as any,
});

// current_period_end moved from the Subscription object to
// items.data[].current_period_end in the Stripe 2025 (basil) API. Webhook
// payloads render at the endpoint's configured version — not the client's
// pinned version — so read the item field first and fall back to the legacy
// top-level field. Returns null rather than an Invalid Date when neither exists.
function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const anySub = sub as any;
  const epoch: number | undefined =
    anySub.items?.data?.[0]?.current_period_end ?? anySub.current_period_end;
  return typeof epoch === "number" && Number.isFinite(epoch)
    ? new Date(epoch * 1000)
    : null;
}

const PLANS = {
  standard: {
    name: "Standard",
    price: 1500,
    features: [
      "50 Permit Searches/mo",
      "5 GMB Photo Optimizations/mo",
      "3 GMB Ranking Grid Reports/mo",
      "Basic GMB Edit Monitoring",
      "1 User",
      "Email Support",
    ],
    limits: { searches: 50, photos: 5, rankings: 3, users: 1, reviewTemplates: 1 },
  },
  professional: {
    name: "Professional",
    price: 3000,
    features: [
      "200 Permit Searches/mo",
      "25 GMB Photo Optimizations/mo",
      "10 GMB Ranking Grid Reports/mo",
      "Advanced GMB Edit Monitoring",
      "Property Records Access",
      "1 User",
      "Priority Email Support",
    ],
    limits: { searches: 200, photos: 25, rankings: 10, users: 1, reviewTemplates: 5 },
  },
  business: {
    name: "Business",
    price: 5000,
    features: [
      "350 Permit Searches/mo",
      "50 GMB Photo Optimizations/mo",
      "15 GMB Ranking Grid Reports/mo",
      "Advanced GMB Edit Monitoring",
      "Property Records Access",
      "Scrape Scheduling",
      "Google Click Guard — 1 Website",
      "1 User",
      "Priority Support",
    ],
    limits: { searches: 350, photos: 50, rankings: 15, users: 1, clickGuardSites: 1, reviewTemplates: 5 },
  },
  premium: {
    name: "Premium",
    price: 10000,
    features: [
      "500 Permit Searches/mo",
      "Unlimited Photo Optimizations",
      "25 GMB Ranking Grid Reports/mo",
      "Advanced GMB Edit Monitoring",
      "Property Records Access",
      "Scrape Scheduling",
      "Google Click Guard — 3 Websites",
      "IP Tracker — 1 Website",
      "1 User",
      "Dedicated Support",
    ],
    limits: { searches: 500, photos: -1, rankings: 25, users: 1, clickGuardSites: 3, ipTrackerSites: 1, reviewTemplates: 20 },
  },
  gold: {
    name: "Gold",
    price: 49900,
    features: [
      "Unlimited Permit Searches",
      "Unlimited Photo Optimizations",
      "Unlimited GMB Ranking Grid Reports",
      "Advanced GMB Edit Monitoring",
      "Property Records Access",
      "Scrape Scheduling",
      "IP Tracker — 1 Website",
      "VPN Shield — 1 Website",
      "Competitor Intel — 1 Site",
      "Up to 2 Users",
      "Priority Support",
    ],
    limits: { searches: -1, photos: -1, rankings: -1, users: 2, ipTrackerSites: 1, vpnShieldSites: 1, competitorSites: 1, reviewTemplates: 20 },
  },
  platinum: {
    name: "Platinum",
    price: 99500,
    features: [
      "Unlimited Permit Searches",
      "Unlimited Photo Optimizations",
      "Unlimited GMB Ranking Grid Reports",
      "Competitor Intelligence & BS Meter — 10 Sites",
      "Advanced GMB Edit Monitoring",
      "Property Records Access",
      "Scrape Scheduling",
      "IP Tracker — 10 Websites",
      "VPN Shield — 10 Websites",
      "30-min Expert Consulting ($250 first session, $500 after)",
      "Up to 5 Users",
      "Dedicated Support",
    ],
    limits: { searches: -1, photos: -1, rankings: -1, users: 5, ipTrackerSites: 10, vpnShieldSites: 10, competitorSites: 10, reviewTemplates: 20 },
  },
};

async function getOrCreateCustomer(userId: number, email: string) {
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

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

export function registerStripeRoutes(app: Express) {
  app.get("/api/stripe/plans", (_req: Request, res: Response) => {
    res.json(PLANS);
  });

  app.get("/api/stripe/subscription", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.json({ plan: "free", status: "inactive" });

      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, user.id))
        .limit(1);

      if (!sub) return res.json({ plan: "free", status: "inactive" });

      res.json({
        plan: sub.plan,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        stripeSubscriptionId: sub.stripeSubscriptionId,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/stripe/create-checkout", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      const { plan } = req.body;
      if (!plan || !PLANS[plan as keyof typeof PLANS]) {
        return res.status(400).json({ message: "Invalid plan" });
      }

      const planConfig = PLANS[plan as keyof typeof PLANS];
      const customerId = await getOrCreateCustomer(user.id, user.email);

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: `ConstructHUB ${planConfig.name}` },
              unit_amount: planConfig.price,
              recurring: { interval: "month" },
            },
            quantity: 1,
          },
        ],
        subscription_data: {
          trial_period_days: 1,
        },
        success_url: `${getBaseUrl(req)}/pricing?success=true`,
        cancel_url: `${getBaseUrl(req)}/pricing?canceled=true`,
        metadata: { userId: String(user.id), plan },
      });

      res.json({ url: session.url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/stripe/create-portal", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, user.id))
        .limit(1);

      if (!sub?.stripeCustomerId) {
        return res.status(400).json({ message: "No subscription found" });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: `${getBaseUrl(req)}/pricing`,
      });

      res.json({ url: session.url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/stripe/create-course-checkout", async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Login required" });

      const { moduleId, bundle } = req.body;

      if (bundle) {
        const allModules = await db.select().from(masterClassModules).where(eq(masterClassModules.isActive, true));
        const customerId = await getOrCreateCustomer(user.id, user.email);

        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: "ConstructHUB Master Class — Complete Bundle (50% Off)",
                  description: allModules.map(m => m.title).join(", "),
                },
                unit_amount: 249900,
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
      res.status(500).json({ message: err.message });
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

      if (items.some((item: any) => SEO_CONTRACT_REQUIRED_IDS.has(item?.id))) {
        return res.status(400).json({ message: "SEO packages require a signed contract before payment. Please use the contract checkout flow." });
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
          resolved.push({ id: String(item.id ?? `course_module_${moduleId}`), type, name: `Master Class — ${mod.title}`, price: mod.price, moduleId });
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
      res.status(500).json({ message: err.message });
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
          const plan = session.metadata?.plan || "standard";
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
            const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription as string);
            await db
              .update(subscriptions)
              .set({
                stripeSubscriptionId: session.subscription as string,
                stripePriceId: stripeSubscription.items.data[0]?.price?.id || null,
                plan,
                status: "active",
                currentPeriodEnd: subscriptionPeriodEnd(stripeSubscription),
              })
              .where(eq(subscriptions.userId, userId));
          }
          break;
        }
        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = sub.customer as string;

          const [existingSub] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.stripeCustomerId, customerId))
            .limit(1);

          if (existingSub) {
            await db
              .update(subscriptions)
              .set({
                status: sub.status === "active" ? "active" : sub.status,
                currentPeriodEnd: subscriptionPeriodEnd(sub),
              })
              .where(eq(subscriptions.id, existingSub.id));
          }
          break;
        }
        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = sub.customer as string;

          await db
            .update(subscriptions)
            .set({ status: "canceled", plan: "free" })
            .where(eq(subscriptions.stripeCustomerId, customerId));
          break;
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });
}
