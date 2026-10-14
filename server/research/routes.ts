/**
 * Research report API (shared/research-reports.ts):
 *   POST /api/research-reports/orders           validate the request + the three agreements, price it on the server,
 *                                               store it with a free preview (awaiting payment)
 *   POST /api/research-reports/orders/:id/checkout   Stripe Checkout for that order (paid up front, non-refundable)
 *   GET  /api/research-reports/orders           my orders (an admin: everyone's, ?all=1)
 *   GET  /api/research-reports/orders/:id       one order, with the report when complete (owner or admin)
 *   POST /api/research-reports/orders/:id/retry  admin: re-queue a failed order
 *   POST /api/research-reports/orders/:id/run    admin: run an unpaid order without checkout (no charge)
 * The webhook side is fulfilResearchCheckout, called from server/stripe.ts applyOneTimeCheckout.
 */
import type { Express, Request, Response } from "express";
import type Stripe from "stripe";
import { stripe } from "../billing/client";
import { appReturnBaseUrl } from "../site-context";
import { rateLimit } from "../growth-limits";
import { isPlatformAdmin } from "../admin";
import { sendWithFallback } from "../email";
import { escapeHtml, firstZodMessage } from "../route-guards";
import {
  researchOrderSchema, researchTierFor, RESEARCH_TIERS, RESEARCH_PATH,
  RESEARCH_NONREFUNDABLE, RESEARCH_NO_GUARANTEE, RESEARCH_NOT_FCRA,
} from "@shared/research-reports";
import { buildPreview, drainResearchQueue } from "./runner";
import { createOrder, getOrder, listOrders, markPaid, orderView, retryOrder, setCheckoutSession } from "./store";

export const RESEARCH_CHECKOUT_TYPE = "research_report";
const TERMS_SNAPSHOT = [RESEARCH_NONREFUNDABLE, RESEARCH_NO_GUARANTEE, RESEARCH_NOT_FCRA].join(" ");

type Deps = { getOrCreateCustomer: (userId: number, email: string) => Promise<string>; sendStripeError: (res: Response, err: any) => unknown };

const orderLimit = rateLimit("research-order", 10, 20, 3600_000);

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
      const parsed = researchOrderSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: firstZodMessage(parsed.error) });
      const input = { ...parsed.data, subjects: parsed.data.subjects.map((s) => ({ ...s, name: s.name.replace(/\s+/g, " ") })) };
      const tier = researchTierFor(input.subjects.length, new Set(input.states).size);
      if (!tier) return res.status(400).json({ message: "That's more than one report covers. Split it into separate orders." });
      input.states = Array.from(new Set(input.states));
      const preview = await buildPreview(input);
      const row = await createOrder({ userId: user.id, email: user.email, tier, priceCents: RESEARCH_TIERS[tier].cents, input, preview, terms: TERMS_SNAPSHOT });
      res.json(orderView(row));
    } catch (err: any) {
      console.error("[research] create order failed:", err);
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
    void drainResearchQueue().catch((err) => console.error("[research] queue:", err));
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
      <p>Purpose: ${escapeHtml(order.input.purpose || "not given")}</p>`,
  }).catch(() => undefined);
  void drainResearchQueue().catch((err) => console.error("[research] queue:", err));
}
