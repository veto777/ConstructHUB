/**
 * Research report API (shared/research-reports.ts):
 *   POST /api/research-reports/orders           validate the request + the three agreements, price it on the server,
 *                                               store it with a free preview (awaiting payment). A platform admin's
 *                                               order (owner, 2026-10-22: zero restrictions) is checked against
 *                                               RESEARCH_ADMIN_LIMITS instead, needs no tier, and is queued at once
 *                                               with no charge (the same admin-run path as /run)
 *   POST /api/research-reports/orders/:id/checkout   Stripe Checkout for that order (paid up front, non-refundable)
 *   GET  /api/research-reports/orders           my orders (an admin: everyone's, ?all=1)
 *   GET  /api/research-reports/orders/:id       one order, with the report when complete (owner or admin)
 *   POST /api/research-reports/orders/:id/retry  admin: re-queue a failed order
 *   POST /api/research-reports/orders/:id/run    admin: run an unpaid order without checkout (no charge)
 *   GET  /api/research-reports/coverage-facets   public: what each loaded state file is indexed by (the coverage page)
 * The webhook side is fulfilResearchCheckout, called from server/stripe.ts applyOneTimeCheckout.
 */
import type { Express, Request, RequestHandler, Response } from "express";
import type Stripe from "stripe";
import { stripe } from "../billing/client";
import { appReturnBaseUrl } from "../site-context";
import { rateLimit } from "../growth-limits";
import { isPlatformAdmin } from "../admin";
import { sendWithFallback } from "../email";
import { escapeHtml, firstZodMessage } from "../route-guards";
import {
  researchOrderSchemaFor, researchTierFor, RESEARCH_TIERS, RESEARCH_PATH,
  RESEARCH_NONREFUNDABLE, RESEARCH_NO_GUARANTEE, RESEARCH_NOT_FCRA,
} from "@shared/research-reports";
import { buildPreview, drainResearchQueue } from "./runner";
import { coverageFacets, coverageRuntime } from "./coverage";
import { createOrder, getOrder, listOrders, markPaid, orderView, retryOrder, setCheckoutSession } from "./store";
import { logError } from "../ops/log";

export const RESEARCH_CHECKOUT_TYPE = "research_report";
const TERMS_SNAPSHOT = [RESEARCH_NONREFUNDABLE, RESEARCH_NO_GUARANTEE, RESEARCH_NOT_FCRA].join(" ");

type Deps = { getOrCreateCustomer: (userId: number, email: string) => Promise<string>; sendStripeError: (res: Response, err: any) => unknown };

const customerOrderLimit = rateLimit("research-order", 10, 20, 3600_000);
/** Customers: ten orders an hour. Platform admins aren't rate limited here (nor is the size of their orders: RESEARCH_ADMIN_LIMITS has no ceilings). */
const orderLimit: RequestHandler = (req, res, next) => (isPlatformAdmin((req as any).user) ? next() : customerOrderLimit(req, res, next));

export function registerResearchRoutes(app: Express, deps: Deps) {
  const own = async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) { res.status(401).json({ message: "Sign in to order a research report" }); return null; }
    const id = Number.parseInt(String(req.params.id), 10);
    const row = Number.isInteger(id) ? await getOrder(id) : null;
    if (!row || (row.user_id !== user.id && !isPlatformAdmin(user))) { res.status(404).json({ message: "Order not found" }); return null; }
    return { user, row };
  };

  app.post("/api/research-reports/orders", orderLimit, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ message: "Sign in to order a research report" });
      const admin = isPlatformAdmin(user);
      const parsed = researchOrderSchemaFor(admin).safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: firstZodMessage(parsed.error) });
      const input = { ...parsed.data, subjects: parsed.data.subjects.map((s) => ({ ...s, name: s.name.replace(/\s+/g, " ") })) };
      input.states = Array.from(new Set(input.states));
      if (admin) {
        // No tier, no preview (it would search every name in every state again before the run) and no charge: stored
        // as an Extended order at $0 (tier stays a value checkout, emails and the page know) and queued at once.
        const row = await createOrder({ userId: user.id, email: user.email, tier: "extended", priceCents: 0, input, preview: null, terms: TERMS_SNAPSHOT });
        await markPaid(row.id, user.id, `admin-run-${row.id}`);
        console.log(`[research] order ${row.id} placed by admin ${user.email} (${input.subjects.length} name(s), ${input.states.length} state(s)), no charge; queued`);
        void drainResearchQueue().catch((err) => logError("[research] queue:", err));
        return res.json(orderView((await getOrder(row.id)) ?? row));
      }
      const tier = researchTierFor(input.subjects.length, input.states.length);
      if (!tier) return res.status(400).json({ message: "That's more than one report covers. Split it into separate orders." });
      const preview = await buildPreview(input);
      const row = await createOrder({ userId: user.id, email: user.email, tier, priceCents: RESEARCH_TIERS[tier].cents, input, preview, terms: TERMS_SNAPSHOT });
      res.json(orderView(row));
    } catch (err: any) {
      logError("[research] create order failed:", err);
      res.status(500).json({ message: "Could not create the order. Please try again." });
    }
  });

  app.post("/api/research-reports/orders/:id/checkout", async (req, res) => {
    try {
      const found = await own(req, res);
      if (!found) return;
      const { user, row } = found;
      if (row.user_id !== user.id) return res.status(403).json({ message: "Only the person who placed the order can pay for it" });
      if (row.status !== "awaiting_payment") return res.status(409).json({ message: "This order is already paid" });
      const customer = await deps.getOrCreateCustomer(user.id, user.email);
      const tier = RESEARCH_TIERS[row.tier];
      const session = await stripe.checkout.sessions.create({
        customer,
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd", unit_amount: row.price_cents,
            product_data: {
              name: `Permit & License Research — ${tier.label}`,
              description: `${row.input.subjects.map((s) => s.name).join(", ")} · ${row.input.states.join(", ")}. Non-refundable. Results not guaranteed.`.slice(0, 500),
            },
          },
          quantity: 1,
        }],
        custom_text: { submit: { message: `${RESEARCH_NONREFUNDABLE} ${RESEARCH_NO_GUARANTEE}`.slice(0, 1200) } },
        success_url: `${appReturnBaseUrl(req)}${RESEARCH_PATH}/orders/${row.id}?paid=1`,
        cancel_url: `${appReturnBaseUrl(req)}${RESEARCH_PATH}/orders/${row.id}?canceled=1`,
        metadata: { userId: String(user.id), type: RESEARCH_CHECKOUT_TYPE, researchOrderId: String(row.id), tier: row.tier },
        payment_intent_data: { description: `ConstructHUB research report #${row.id} (non-refundable)`, metadata: { researchOrderId: String(row.id) } },
      });
      await setCheckoutSession(row.id, session.id);
      res.json({ url: session.url });
    } catch (err: any) {
      deps.sendStripeError(res, err);
    }
  });

  // The coverage page's live detail for the daily files: identifiers and record kinds seen in the loaded rows, row
  // counts and load dates. Public (it says what we search, never what we found); cached six hours in coverageFacets.
  app.get("/api/research-reports/coverage-facets", async (_req, res) => {
    try {
      res.set("Cache-Control", "public, max-age=3600");
      res.json(await coverageFacets());
    } catch (err) {
      logError("[research] coverage facets failed:", err);
      res.status(503).json({});
    }
  });

  // What the running server searches beyond the build's manifest (OSHA when it holds the Labor Department key, SAM.gov
  // exclusions once their file has loaded).
  app.get("/api/research-reports/coverage-runtime", async (_req, res) => {
    res.set("Cache-Control", "public, max-age=600");
    res.json(await coverageRuntime());
  });

  app.get("/api/research-reports/orders", async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ message: "Not authenticated" });
    const all = req.query.all === "1" && isPlatformAdmin(user);
    res.json((await listOrders(all ? null : user.id)).map(orderView));
  });

  app.get("/api/research-reports/orders/:id", async (req, res) => {
    const found = await own(req, res);
    if (found) res.json(orderView(found.row));
  });

  // Platform admins skip the paywall: the order is marked paid with no Stripe session and no charge.
  app.post("/api/research-reports/orders/:id/run", async (req, res) => {
    const found = await own(req, res);
    if (!found) return;
    const { user, row } = found;
    if (!isPlatformAdmin(user)) return res.status(403).json({ message: "Administrator access required" });
    if (!(await markPaid(row.id, row.user_id, `admin-run-${row.id}`))) return res.status(409).json({ message: "This order is already paid" });
    console.log(`[research] order ${row.id} run by admin ${user.email} without payment; queued`);
    void drainResearchQueue().catch((err) => logError("[research] queue:", err));
    res.json({ ok: true });
  });

  app.post("/api/research-reports/orders/:id/retry", async (req, res) => {
    const user = (req as any).user;
    if (!user || !isPlatformAdmin(user)) return res.status(403).json({ message: "Administrator access required" });
    const ok = await retryOrder(Number.parseInt(String(req.params.id), 10));
    if (!ok) return res.status(409).json({ message: "Only a failed order can be retried" });
    void drainResearchQueue();
    res.json({ ok: true });
  });
}

/**
 * The webhook side (checkout.session.completed / async_payment_succeeded): a paid research checkout marks its order
 * paid once and starts the bot. Only Stripe's paid status counts, never the metadata alone.
 */
export async function fulfilResearchCheckout(session: Stripe.Checkout.Session, userId: number): Promise<void> {
  if (session.metadata?.type !== RESEARCH_CHECKOUT_TYPE || session.mode !== "payment" || session.payment_status !== "paid") return;
  const id = Number.parseInt(session.metadata?.researchOrderId ?? "", 10);
  if (!Number.isInteger(id)) throw new Error(`[research] checkout ${session.id} has no research order id`);
  const order = await getOrder(id);
  if (!order) throw new Error(`[research] checkout ${session.id}: order ${id} not found`);
  if (order.price_cents !== session.amount_total) console.error(`[research] order ${id}: paid ${session.amount_total} for a ${order.price_cents} order`);
  if (!(await markPaid(id, userId, session.id))) return; // already paid (a redelivery)
  console.log(`[research] order ${id} paid; queued`);
  await sendWithFallback({
    from: `"ConstructHUB" <${process.env.SMTP_EMAIL}>`, to: process.env.SMTP_EMAIL, replyTo: order.email,
    subject: `Research report ordered #${id} (${order.tier}): the bot is on it`,
    html: `<p>${escapeHtml(order.email)} ordered: ${escapeHtml(order.input.subjects.map((s) => `${s.name} (${s.kind})`).join(", "))} in ${escapeHtml(order.input.states.join(", "))}.</p>
      <p>Purpose: ${escapeHtml(order.input.purpose || "not given")}</p>
      <p>Anything else we should know (the customer's note): ${escapeHtml(order.input.notes || "none")}</p>`,
  }).catch(() => undefined);
  void drainResearchQueue().catch((err) => logError("[research] queue:", err));
}
