/**
 * STRIPE (CRM payments) — tutorial fixture. Recording slots only (../gate.ts).
 *
 * Seam: the `stripe` client and the Connect client id / webhook secret that server/crm/payments.ts
 * and server/crm/integrations.ts build at the top of the file. In a slot they get THE REAL STRIPE
 * SDK, constructed with an HTTP client that answers on this machine instead of calling Stripe — so
 * the product's own code (rails, fees, the pending row, the ledger, receipts, notifications) runs
 * unchanged, and nothing here is reachable when the gate is off.
 *
 * Stripe's hosted checkout cannot be shown, so a checkout session's `url` points at a local
 * STAND-IN page: a plain "secure checkout" page that copies nothing of Stripe's branding or layout.
 * Its Pay button builds the event Stripe would send, SIGNS it with the slot's own random webhook
 * secret and POSTs it to the real endpoint, /api/crm/stripe/connect-webhook — the signature check
 * there is exactly the production one (stripe.webhooks.constructEvent). Nothing is bypassed: a
 * request without a valid signature is refused in a slot as it is in production.
 */
import { randomBytes } from "crypto";
import Stripe from "stripe";
import type { Router } from "express";
import { FIXTURE_MARK } from "../gate";
import { defineProviderFixture, requireTutorialFixtures, FIXTURE_ROUTE_PREFIX } from "../registry";

export type StripeFixture = {
  secretKey: string;
  connectClientId: string;
  webhookSecret: string;
  client: Stripe;
};

/** The demo workspace's stand-in connected account (seeded by scripts/tutorials/seed-fixtures.ts). */
export const FIXTURE_STRIPE_ACCOUNT = `${FIXTURE_MARK.stripeAccount}AspireInteriors01`;
export const FIXTURE_STRIPE_BUSINESS = { name: "Aspire Interiors", email: "office@aspireinteriors.example.com", country: "US", currency: "usd" };

type Rail = "card" | "ach";
type Session = {
  id: string; url: string; amount: number; currency: string; name: string; payee: string | null; email: string | null;
  successUrl: string; cancelUrl: string; metadata: Record<string, string>; methods: string[];
  status: "open" | "complete" | "expired"; paymentStatus: "unpaid" | "paid"; intent: string | null; account: string;
};
const sessions = new Map<string, Session>();
const rid = (n = 12) => randomBytes(n).toString("hex").slice(0, n * 2);
const intentFor = (rail: Rail, key: string) => `pi_${FIXTURE_MARK.stripeObject}_${rail}_${key}`;
const chargeFor = (intent: string) => intent.replace(/^pi_/, "ch_");
const railOf = (id: string): Rail => (/_ach_/.test(id) ? "ach" : "card");

const sessionObject = (s: Session) => ({
  id: s.id, object: "checkout.session", url: s.status === "open" ? s.url : null, mode: "payment", livemode: false,
  status: s.status, payment_status: s.paymentStatus, payment_intent: s.intent, amount_total: s.amount, currency: s.currency,
  customer_email: s.email, metadata: s.metadata, payment_method_types: s.methods, success_url: s.successUrl, cancel_url: s.cancelUrl,
});
const intentObject = (id: string, expandCharge: boolean) => {
  const rail = railOf(id);
  const charge = {
    id: chargeFor(id), object: "charge", paid: true, status: "succeeded", payment_intent: id,
    payment_method_details: rail === "card"
      ? { type: "card", card: { brand: "visa", last4: "4242" } }
      : { type: "us_bank_account", us_bank_account: { bank_name: "Demo Community Bank", last4: "6789" } },
  };
  return { id, object: "payment_intent", status: "succeeded", livemode: false, latest_charge: expandCharge ? charge : charge.id };
};

/** application/x-www-form-urlencoded with bracket keys → flat map ("line_items[0][price_data][unit_amount]" → value). */
const form = (body: unknown): Map<string, string> => new Map(new URLSearchParams(typeof body === "string" ? body : ""));

/** What the SDK's HTTP client talks to: the handful of Stripe endpoints the CRM uses. */
async function stripeApi(input: any, init: any = {}): Promise<Response> {
  requireTutorialFixtures("the Stripe stand-in");
  const url = new URL(String(input));
  const method = String(init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  const account = headers.get("stripe-account") || FIXTURE_STRIPE_ACCOUNT;
  const ok = (json: unknown) => Response.json(json, { headers: { "request-id": `req_${FIXTURE_MARK.stripeObject}_${rid(6)}` } });
  const notFound = (what: string) => Response.json({ error: { type: "invalid_request_error", code: "resource_missing", message: `No such ${what}` } }, { status: 404 });
  const p = url.pathname;

  if (method === "POST" && p === "/v1/checkout/sessions") {
    const f = form(init.body);
    const id = `cs_test_${FIXTURE_MARK.stripeObject}_${rid()}`;
    const successUrl = f.get("success_url") || "";
    const metadata: Record<string, string> = {};
    const methods: string[] = [];
    for (const [k, v] of f) {
      const m = /^metadata\[(.+)\]$/.exec(k); if (m) metadata[m[1]] = v;
      if (/^payment_method_types\[\d+\]$/.test(k)) methods.push(v);
    }
    const s: Session = {
      id, url: `${new URL(successUrl).origin}${FIXTURE_ROUTE_PREFIX}/stripe/checkout/${id}`,
      amount: Number(f.get("line_items[0][price_data][unit_amount]")) * Number(f.get("line_items[0][quantity]") || 1),
      currency: f.get("line_items[0][price_data][currency]") || "usd",
      name: f.get("line_items[0][price_data][product_data][name]") || "Payment",
      payee: f.get("line_items[0][price_data][product_data][description]") || null,
      email: f.get("customer_email") || null, successUrl, cancelUrl: f.get("cancel_url") || successUrl,
      metadata, methods, status: "open", paymentStatus: "unpaid", intent: null, account,
    };
    sessions.set(id, s);
    return ok(sessionObject(s));
  }
  if (method === "GET" && p === "/v1/checkout/sessions") {
    const intent = url.searchParams.get("payment_intent");
    return ok({ object: "list", has_more: false, data: [...sessions.values()].filter((s) => s.intent === intent).map(sessionObject) });
  }
  let m = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(p);
  if (method === "GET" && m) { const s = sessions.get(m[1]); return s ? ok(sessionObject(s)) : notFound("checkout.session"); }
  m = /^\/v1\/payment_intents\/([^/]+)$/.exec(p);
  if (method === "GET" && m) {
    if (!m[1].startsWith(`pi_${FIXTURE_MARK.stripeObject}_`)) return notFound("payment_intent");
    return ok(intentObject(m[1], [...url.searchParams.values()].includes("latest_charge")));
  }
  m = /^\/v1\/accounts\/([^/]+)$/.exec(p);
  if (method === "GET" && m) {
    if (!m[1].startsWith(FIXTURE_MARK.stripeAccount)) return notFound("account");
    return ok({
      id: m[1], object: "account", type: "standard", charges_enabled: true, payouts_enabled: true, details_submitted: true,
      capabilities: { card_payments: "active", us_bank_account_ach_payments: "active", transfers: "active" },
      business_profile: { name: FIXTURE_STRIPE_BUSINESS.name }, email: FIXTURE_STRIPE_BUSINESS.email,
      country: FIXTURE_STRIPE_BUSINESS.country, default_currency: FIXTURE_STRIPE_BUSINESS.currency,
    });
  }
  if (method === "POST" && p === "/oauth/token") return ok({ stripe_user_id: FIXTURE_STRIPE_ACCOUNT, livemode: false, scope: "read_write", token_type: "bearer" });
  if (method === "POST" && p === "/oauth/deauthorize") return ok({ stripe_user_id: form(init.body).get("stripe_user_id") || FIXTURE_STRIPE_ACCOUNT });
  return Response.json({ error: { type: "invalid_request_error", message: `The Stripe stand-in does not implement ${method} ${p}` } }, { status: 400 });
}

let built: StripeFixture | null = null;
function adapter(): StripeFixture {
  if (built) return built;
  const secretKey = `sk_test_${FIXTURE_MARK.stripeObject}_${rid(16)}`;
  built = {
    secretKey,
    connectClientId: `ca_${FIXTURE_MARK.stripeObject}_recordingslot`,
    // Random per process: only this process can sign an event its own webhook will accept.
    webhookSecret: `whsec_${rid(24)}`,
    client: new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient(stripeApi as any), maxNetworkRetries: 0, telemetry: false }),
  };
  return built;
}

/** Sign an event the way Stripe does and deliver it to the product's real Connect webhook. */
async function deliver(type: string, object: Record<string, unknown>, account: string): Promise<void> {
  requireTutorialFixtures("delivering a stand-in Stripe event");
  const fx = adapter();
  const payload = JSON.stringify({
    id: `evt_${FIXTURE_MARK.stripeObject}_${rid()}`, object: "event", api_version: "2025-01-27.acacia", created: Math.floor(Date.now() / 1000),
    livemode: false, type, account, data: { object },
  });
  const signature = fx.client.webhooks.generateTestHeaderString({ payload, secret: fx.webhookSecret });
  const r = await fetch(`http://127.0.0.1:${process.env.PORT}/api/crm/stripe/connect-webhook`, {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: payload,
  });
  if (!r.ok) throw new Error(`the Connect webhook answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/** The client pressed Pay on the stand-in page (or a script paid for them). */
async function pay(s: Session, rail: Rail): Promise<void> {
  if (s.status !== "open") return;
  s.intent = intentFor(rail, s.id.split("_").pop()!);
  s.status = "complete";
  // A card settles at once. A bank debit completes the session unpaid and settles days later
  // (`stripe.settle`), which is why the product shows it as processing in between.
  s.paymentStatus = rail === "card" ? "paid" : "unpaid";
  await deliver("checkout.session.completed", sessionObject(s), s.account);
}

type PayRow = { id: string; amount_cents: number; status: string; checkout_session_id: string | null; payment_intent_id: string | null; charge_id: string | null; stripe_account_id: string | null; method: string | null };
/** A stand-in payment of the demo workspace: by id, or the newest one in one of `statuses`. */
async function findPayment(orgId: string, input: Record<string, any>, statuses: string[]): Promise<PayRow> {
  const { pool } = await import("../../../db");
  const { rows } = await pool.query(
    `select id, amount_cents, status, checkout_session_id, payment_intent_id, charge_id, stripe_account_id, method from crm_payments
      where org_id = $1 and provider = 'stripe' and stripe_account_id like $2 and ($3::text is null or id = $3) and status = any($4::text[])
      order by created_at desc limit 1`, [orgId, `${FIXTURE_MARK.stripeAccount}%`, input.paymentId ?? null, statuses]);
  if (!rows[0]) throw new Error(`no stand-in payment${input.paymentId ? ` ${input.paymentId}` : ""} in ${statuses.join(" / ")}`);
  return rows[0];
}
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** The stand-in checkout page. Deliberately plain: our own neutral layout, no provider's name, logo, colours or wording. */
function checkoutPage(s: Session): string {
  const bank = s.methods.includes("us_bank_account"), card = s.methods.includes("card");
  const option = (value: Rail, title: string, detail: string, checked: boolean) => `
    <label class="opt" data-testid="checkout-method-${value}">
      <input type="radio" name="method" value="${value}"${checked ? " checked" : ""}>
      <span><b>${title}</b><small>${detail}</small></span>
    </label>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Secure checkout</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#f4f5f7;color:#1f2933;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{max-width:880px;margin:0 auto;padding:28px 24px;display:grid;grid-template-columns:1fr 1.15fr;gap:22px;align-items:start}
  h1{font-size:15px;font-weight:600;color:#52606d;margin:0 0 18px;display:flex;align-items:center;gap:8px;grid-column:1/-1}
  h1 svg{width:17px;height:17px} .card{background:#fff;border:1px solid #d9dee4;border-radius:10px;padding:20px}
  .payee{color:#52606d;font-size:13px} .what{font-weight:600;margin:4px 0 14px} .amt{font-size:34px;font-weight:700;letter-spacing:-.5px}
  .row{display:flex;justify-content:space-between;border-top:1px solid #e6e9ed;margin-top:14px;padding-top:12px;font-size:13px;color:#52606d}
  .opt{display:flex;gap:12px;align-items:flex-start;border:1px solid #d9dee4;border-radius:8px;padding:12px 14px;margin-bottom:10px;cursor:pointer}
  .opt:has(input:checked){border-color:#334e68;background:#f0f4f8} .opt small{display:block;color:#627d98;font-size:12.5px} .opt input{margin-top:4px}
  button{width:100%;border:0;border-radius:8px;background:#243b53;color:#fff;font:600 16px system-ui,sans-serif;padding:13px;cursor:pointer;margin-top:6px}
  a.cancel{display:block;text-align:center;margin-top:12px;color:#52606d;font-size:13px} h2{font-size:14px;margin:0 0 12px}
  footer{grid-column:1/-1;text-align:center;color:#829ab1;font-size:12px}
</style></head><body><main data-testid="checkout-standin">
  <h1><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Secure checkout</h1>
  <section class="card" data-testid="checkout-summary">
    <div class="payee">${esc(s.payee || "Payment")}</div>
    <div class="what" data-testid="checkout-item">${esc(s.name)}</div>
    <div class="amt" data-testid="checkout-amount">${esc(money(s.amount, s.currency))}</div>
    ${s.email ? `<div class="row"><span>Receipt to</span><span data-testid="checkout-email">${esc(s.email)}</span></div>` : ""}
  </section>
  <form class="card" method="post" action="${FIXTURE_ROUTE_PREFIX}/stripe/checkout/${esc(s.id)}/pay" data-testid="checkout-form">
    <h2>How would you like to pay?</h2>
    ${bank ? option("ach", "Bank account", "Pay straight from your bank account.", true) : ""}
    ${card ? option("card", "Card", "Credit or debit card.", !bank) : ""}
    <button type="submit" data-testid="button-checkout-pay">Pay ${esc(money(s.amount, s.currency))}</button>
    <a class="cancel" href="${esc(s.cancelUrl)}" data-testid="link-checkout-cancel">Cancel and go back</a>
  </form>
  <footer data-testid="checkout-standin-note">Demonstration checkout page — no real payment is taken.</footer>
</main></body></html>`;
}

function routes(r: Router) {
  r.get("/checkout/:id", (req, res) => {
    const s = sessions.get(String(req.params.id));
    if (!s) return res.status(404).type("text/plain").send("This checkout is no longer open.");
    if (s.status !== "open") return res.redirect(303, s.successUrl);
    res.type("html").send(checkoutPage(s));
  });
  r.post("/checkout/:id/pay", async (req, res) => {
    const s = sessions.get(String(req.params.id));
    if (!s) return res.status(404).type("text/plain").send("This checkout is no longer open.");
    const want: Rail = req.body?.method === "card" ? "card" : "ach";
    const rail: Rail = want === "card" && s.methods.includes("card") ? "card" : s.methods.includes("us_bank_account") ? "ach" : "card";
    try { await pay(s, rail); } catch (e: any) { return res.status(502).type("text/plain").send(String(e?.message || e).slice(0, 300)); }
    res.redirect(303, s.successUrl);
  });
}

export const stripeFixture = defineProviderFixture<StripeFixture>({
  id: "stripe",
  simulates: "A connected Stripe account for the demo workspace: checkout sessions, a stand-in checkout page, and the signed events (paid, bank debit settling, failed, refunded) that settle a payment.",
  seam: "server/crm/payments.ts + server/crm/integrations.ts — the module-level `stripe` client, Connect client id and Connect webhook secret",
  adapter,
  routes,
  actions: {
    /** Pay the newest open checkout without showing the stand-in page. { method: "card" | "ach" } */
    pay: async (input) => {
      const open = [...sessions.values()].filter((s) => s.status === "open").pop();
      if (!open) throw new Error("no checkout is open");
      await pay(open, input.method === "ach" ? "ach" : "card");
      return { sessionId: open.id };
    },
    /** A bank debit clears: the processing payment becomes paid. { paymentId? } */
    settle: async (input, { orgId }) => {
      const row = await findPayment(orgId, input, ["processing", "pending"]);
      const intent = row.payment_intent_id ?? intentFor("ach", row.id.replace(/[^a-z0-9]/gi, ""));
      await deliver("checkout.session.async_payment_succeeded", { id: row.checkout_session_id, object: "checkout.session", payment_intent: intent, payment_status: "paid", metadata: { orgId } }, row.stripe_account_id!);
      return { paymentId: row.id };
    },
    /** A bank debit or card is declined. { paymentId?, reason? } */
    fail: async (input, { orgId }) => {
      const row = await findPayment(orgId, input, ["processing", "pending"]);
      const reason = String(input.reason || "The bank declined this payment.").slice(0, 160);
      // With an intent on the row, the event Stripe sends carries the reason; a checkout that never got that far just fails.
      if (row.payment_intent_id) await deliver("payment_intent.payment_failed", { id: row.payment_intent_id, object: "payment_intent", status: "requires_payment_method", latest_charge: null, metadata: { orgId }, last_payment_error: { message: reason } }, row.stripe_account_id!);
      else await deliver("checkout.session.async_payment_failed", { id: row.checkout_session_id, object: "checkout.session", payment_intent: null, payment_status: "unpaid", metadata: { orgId } }, row.stripe_account_id!);
      return { paymentId: row.id };
    },
    /** Refund a paid payment, whole or in part (cumulative, as Stripe reports it). { paymentId?, amountCents? } */
    refund: async (input, { orgId }) => {
      const row = await findPayment(orgId, input, ["succeeded", "partially_refunded"]);
      if (!row.payment_intent_id) throw new Error("that payment has no stand-in payment intent");
      const amount = Math.min(row.amount_cents, Math.max(1, Math.round(Number(input.amountCents) || row.amount_cents)));
      await deliver("charge.refunded", { id: row.charge_id ?? chargeFor(row.payment_intent_id), object: "charge", payment_intent: row.payment_intent_id, amount_refunded: amount, refunded: amount >= row.amount_cents }, row.stripe_account_id!);
      return { paymentId: row.id, refundedCents: amount };
    },
  },
});
