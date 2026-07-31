/**
 * Connected payments — the contractor's own Stripe account, ACH-first.
 *
 * Architecture (analysis/PAYMENTS-ACH.md):
 *   - **Stripe Connect Standard + direct charges.** The contractor is merchant
 *     of record; funds never enter a balance we control. Fraud, dispute and
 *     negative-balance liability stay with Stripe/the contractor, NOT us.
 *     Express and Custom shift losses onto the platform — do not use them.
 *   - **Connect Standard costs the platform $0.**
 *   - **ACH Direct Debit** is the default rail: a $25,000 deposit costs the
 *     contractor ~$5.00 (0.8% capped at $5) versus ~$725 on card.
 *   - `applicationFeeCents` stays 0. We are not skimming deposits.
 *
 * What we deliberately do NOT do: hold funds, promise that funds are never
 * held (Stripe's risk engine sits underneath and no platform can promise that),
 * or use destination charges.
 */
import type { Express } from "express";
import { randomBytes } from "crypto";
import Stripe from "stripe";
import { db } from "../db";
import {
  crmPaymentAccounts, crmPayments, crmEstimates, crmInvoices, crmCustomers, crmOrgs,
} from "@shared/schema";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { requireDocSession } from "./portal";
import { getBaseUrl } from "../auth";

type GetUser = (req: any, res: any) => any;

/** A checkout session stays open for a while; don't stack a second one on top. */
const OPEN_SESSION_WINDOW_MIN = 30;

async function hasOpenSession(where: any): Promise<boolean> {
  // Compare against the DATABASE clock, not a JS Date: these columns are
  // `timestamp without time zone` written by now(), so a UTC-serialised JS
  // Date is skewed by the server's timezone offset.
  const rows = await db.select({ id: crmPayments.id }).from(crmPayments)
    .where(and(where, eq(crmPayments.status, "pending"),
      sql`${crmPayments.createdAt} >= now() - make_interval(mins => ${OPEN_SESSION_WINDOW_MIN})`))
    .limit(1);
  return rows.length > 0;
}

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
// Connect OAuth needs the platform's client id from the Stripe dashboard
// (Settings → Connect → Onboarding options). Without it we report "not
// configured" rather than rendering a broken Connect button.
const CONNECT_CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID;

const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY) : null;

export function stripeConnectConfigured(): boolean {
  return Boolean(stripe && CONNECT_CLIENT_ID);
}

/** The org's live connected account, if any. */
async function activeAccount(orgId: string) {
  const [row] = await db.select().from(crmPaymentAccounts)
    .where(and(eq(crmPaymentAccounts.orgId, orgId), isNull(crmPaymentAccounts.disconnectedAt)))
    .orderBy(desc(crmPaymentAccounts.createdAt)).limit(1);
  return row ?? null;
}

export function registerCrmPaymentRoutes(app: Express, getDevUser: GetUser): void {
  // ── Status ────────────────────────────────────────────────────────────────

  app.get("/api/crm/payments/status", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;

    const acct = await activeAccount(ctx.org.id);
    res.json({
      configured: stripeConnectConfigured(),
      // Tell the operator exactly which env var is missing rather than failing silently.
      missing: stripeConnectConfigured() ? [] : [
        ...(!STRIPE_KEY ? ["STRIPE_SECRET_KEY"] : []),
        ...(!CONNECT_CLIENT_ID ? ["STRIPE_CONNECT_CLIENT_ID"] : []),
      ],
      account: acct ? {
        id: acct.id, provider: acct.provider, externalAccountId: acct.externalAccountId,
        livemode: acct.livemode, chargesEnabled: acct.chargesEnabled,
        achEnabled: acct.achEnabled, cardEnabled: acct.cardEnabled,
        businessName: acct.businessName, accountEmail: acct.accountEmail,
        country: acct.country, lastCheckedAt: acct.lastCheckedAt, lastError: acct.lastError,
      } : null,
      // Stated up front, in the product, per the spec's honesty requirement.
      disclosure: {
        custody: "Payments go directly into your own Stripe account. We never hold your money.",
        achFee: "ACH: 0.8% capped at $5.00 per payment (Stripe's rate — we add nothing).",
        cardFee: "Card: 2.9% + 30¢ (Stripe's rate — we add nothing).",
        platformFee: "ConstructHub CRM takes $0 of your payments.",
        holds: "Stripe may review or hold funds under their risk policy. No platform can override that, and we will never claim otherwise.",
      },
    });
  });

  // ── Connect (OAuth, Standard) ─────────────────────────────────────────────

  app.get("/api/crm/payments/connect/stripe", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageIntegrations")) return;
    if (!stripeConnectConfigured()) {
      return res.status(503).json({
        message: "Stripe Connect isn't configured on this server yet.",
        missing: [...(!STRIPE_KEY ? ["STRIPE_SECRET_KEY"] : []), ...(!CONNECT_CLIENT_ID ? ["STRIPE_CONNECT_CLIENT_ID"] : [])],
      });
    }

    // CSRF: bind the OAuth round-trip to this session.
    const state = randomBytes(24).toString("hex");
    if (req.session) {
      req.session.stripeConnectState = state;
      req.session.stripeConnectOrgId = ctx.org.id;
    }
    const redirectUri = `${getBaseUrl(req)}/api/crm/payments/connect/stripe/callback`;
    const url =
      `https://connect.stripe.com/oauth/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(CONNECT_CLIENT_ID!)}` +
      `&scope=read_write` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}` +
      `&stripe_user[email]=${encodeURIComponent(ctx.org.email || "")}` +
      `&stripe_user[business_name]=${encodeURIComponent(ctx.org.name || "")}`;
    res.json({ url });
  });

  app.get("/api/crm/payments/connect/stripe/callback", async (req: any, res) => {
    const back = (q: string) => res.redirect(`/crm/payments?${q}`);
    const user = getDevUser(req, res);
    if (!user) return;
    if (!stripe) return back("error=not_configured");

    const { code, state, error } = req.query;
    if (error) return back(`error=${encodeURIComponent(String(error))}`);
    if (!code || !state) return back("error=missing_code");
    if (!req.session?.stripeConnectState || req.session.stripeConnectState !== state) {
      return back("error=state_mismatch");
    }
    const orgId = req.session.stripeConnectOrgId;
    delete req.session.stripeConnectState;
    delete req.session.stripeConnectOrgId;

    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (ctx.org.id !== orgId) return back("error=org_mismatch");

    try {
      const tok = await stripe.oauth.token({ grant_type: "authorization_code", code: String(code) });
      const acctId = String(tok.stripe_user_id);
      const acct = await stripe.accounts.retrieve(acctId);

      // us_bank_account is Stripe's ACH Direct Debit capability.
      const caps: any = acct.capabilities || {};
      const ach = caps.us_bank_account_ach_payments === "active";
      const card = caps.card_payments === "active";

      await db.update(crmPaymentAccounts)
        .set({ disconnectedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(crmPaymentAccounts.orgId, ctx.org.id), isNull(crmPaymentAccounts.disconnectedAt)));

      await db.insert(crmPaymentAccounts).values({
        orgId: ctx.org.id, provider: "stripe", externalAccountId: acctId,
        livemode: Boolean(tok.livemode),
        chargesEnabled: Boolean(acct.charges_enabled),
        achEnabled: ach, cardEnabled: card,
        accountEmail: acct.email ?? null,
        businessName: (acct.business_profile?.name as string) ?? null,
        country: acct.country ?? null,
        defaultCurrency: acct.default_currency ?? null,
        connectedByMemberId: ctx.member.id,
        lastCheckedAt: new Date(),
      } as any);

      return back(`connected=1${ach ? "" : "&ach=off"}`);
    } catch (e: any) {
      console.error("[crm] stripe connect failed:", e?.message || e);
      return back(`error=${encodeURIComponent(String(e?.message || "connect_failed").slice(0, 120))}`);
    }
  });

  /** Re-read capabilities from Stripe (ACH is often enabled after onboarding). */
  app.post("/api/crm/payments/refresh", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageIntegrations")) return;
    const acct = await activeAccount(ctx.org.id);
    if (!acct || !stripe) return res.status(404).json({ message: "No connected account" });
    try {
      const a = await stripe.accounts.retrieve(acct.externalAccountId);
      const caps: any = a.capabilities || {};
      const [row] = await db.update(crmPaymentAccounts).set({
        chargesEnabled: Boolean(a.charges_enabled),
        achEnabled: caps.us_bank_account_ach_payments === "active",
        cardEnabled: caps.card_payments === "active",
        businessName: (a.business_profile?.name as string) ?? acct.businessName,
        lastCheckedAt: new Date(), lastError: null, updatedAt: new Date(),
      }).where(eq(crmPaymentAccounts.id, acct.id)).returning();
      res.json({ ok: true, achEnabled: row.achEnabled, cardEnabled: row.cardEnabled, chargesEnabled: row.chargesEnabled });
    } catch (e: any) {
      await db.update(crmPaymentAccounts)
        .set({ lastError: String(e?.message || e).slice(0, 300), lastCheckedAt: new Date() })
        .where(eq(crmPaymentAccounts.id, acct.id));
      res.status(502).json({ message: String(e?.message || e).slice(0, 200) });
    }
  });

  app.post("/api/crm/payments/disconnect", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageIntegrations")) return;
    const acct = await activeAccount(ctx.org.id);
    if (!acct) return res.status(404).json({ message: "No connected account" });
    // Best-effort de-authorise; the local record is marked regardless so the UI
    // never shows a connection the contractor thinks they removed.
    if (stripe && CONNECT_CLIENT_ID) {
      await stripe.oauth.deauthorize({ client_id: CONNECT_CLIENT_ID, stripe_user_id: acct.externalAccountId })
        .catch((e: any) => console.error("[crm] deauthorize:", e?.message || e));
    }
    await db.update(crmPaymentAccounts)
      .set({ disconnectedAt: new Date(), updatedAt: new Date() })
      .where(eq(crmPaymentAccounts.id, acct.id));
    res.json({ ok: true });
  });

  app.get("/api/crm/payments", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!ctx.permissions.seePrices) return res.status(403).json({ message: "Requires permission: seePrices" });
    const rows = await db.select().from(crmPayments)
      .where(eq(crmPayments.orgId, ctx.org.id)).orderBy(desc(crmPayments.createdAt)).limit(200);
    res.json(rows);
  });

  // ── Public: client pays the deposit on an approved estimate ────────────────
  // Hosted Stripe Checkout on the CONNECTED account (direct charge), ACH first.

  /** Public: pay an invoice. Same direct-charge model as the deposit flow. */
  app.post("/api/public/invoices/:token/pay", async (req: any, res) => {
    const t = String(req.params.token || "");
    const [inv] = await db.select().from(crmInvoices).where(eq(crmInvoices.publicToken, t)).limit(1);
    if (!inv) return res.status(404).json({ message: "This invoice link is no longer valid." });
    // Email gate, same as the document read: paying requires the verified session.
    if (!(await requireDocSession(req, res, inv.customerId))) return;
    if (inv.voidedAt) return res.status(410).json({ message: "This invoice has been voided." });
    // Retainage is withheld until closeout, so it is not payable now.
    const amount = Math.max(0, inv.totalCents - (inv.retainageCents ?? 0) - (inv.paidCents ?? 0));
    if (amount < 50) return res.status(400).json({ message: "Nothing left to pay." });
    // Double-pay guard: one open checkout session at a time per invoice. The
    // webhook hasn't landed yet while a session is open, so paidCents alone
    // can't stop a client from paying twice in two tabs.
    if (await hasOpenSession(eq(crmPayments.invoiceId, inv.id))) {
      return res.status(409).json({
        message: "A checkout session is already open for this invoice. Finish it (or wait 30 minutes) before starting another.",
      });
    }

    const acct = await activeAccount(inv.orgId);
    if (!acct || !acct.chargesEnabled || !stripe) {
      return res.status(503).json({ message: "Online payment isn't set up yet. Please contact us to arrange payment." });
    }
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, inv.orgId)).limit(1);
    const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, inv.customerId)).limit(1);
    const methods: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] = [];
    if (acct.achEnabled) methods.push("us_bank_account");
    if (acct.cardEnabled) methods.push("card");
    if (!methods.length) methods.push("card");
    const base = getBaseUrl(req);
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment", payment_method_types: methods,
        customer_email: cust?.email ?? undefined,
        line_items: [{ quantity: 1, price_data: {
          currency: acct.defaultCurrency || "usd", unit_amount: amount,
          product_data: {
            name: `Invoice ${inv.number ?? ""} — ${inv.title}`,
            description: org?.name ? `Payable to ${org.name}` : undefined,
          },
        }}],
        success_url: `${base}/i/${t}?paid=1`,
        cancel_url: `${base}/i/${t}?paid=0`,
        metadata: { invoiceId: inv.id, orgId: inv.orgId, customerId: inv.customerId },
      }, { stripeAccount: acct.externalAccountId });

      await db.insert(crmPayments).values({
        orgId: inv.orgId, customerId: inv.customerId, invoiceId: inv.id,
        projectId: inv.projectId ?? null, provider: "stripe", externalId: session.id,
        purpose: "progress", amountCents: amount, currency: acct.defaultCurrency || "usd",
        method: acct.achEnabled ? "ach" : "card", status: "pending", applicationFeeCents: 0,
      } as any);
      res.json({ url: session.url, amountCents: amount, achAvailable: acct.achEnabled });
    } catch (e: any) {
      console.error("[crm] invoice checkout failed:", e?.message || e);
      res.status(502).json({ message: String(e?.message || "Could not start checkout").slice(0, 200) });
    }
  });

  app.post("/api/public/estimates/:token/pay", async (req: any, res) => {
    const t = String(req.params.token || "");
    const [est] = await db.select().from(crmEstimates).where(eq(crmEstimates.publicToken, t)).limit(1);
    if (!est) return res.status(404).json({ message: "This estimate link is no longer valid." });
    // Email gate, same as the document read: paying requires the verified session.
    if (!(await requireDocSession(req, res, est.customerId))) return;
    if (!est.approvedAt) return res.status(409).json({ message: "Approve the estimate first." });

    const amount = est.depositCents && est.depositCents > 0 ? est.depositCents : est.totalCents;
    if (!amount || amount < 50) return res.status(400).json({ message: "Nothing to pay." });

    // Double-pay guard: the deposit must not be collectable twice.
    const settled = await db.select({ id: crmPayments.id }).from(crmPayments)
      .where(and(eq(crmPayments.estimateId, est.id), eq(crmPayments.status, "succeeded"))).limit(1);
    if (settled.length) {
      return res.status(409).json({ message: "This estimate has already been paid." });
    }
    if (await hasOpenSession(eq(crmPayments.estimateId, est.id))) {
      return res.status(409).json({
        message: "A checkout session is already open for this estimate. Finish it (or wait 30 minutes) before starting another.",
      });
    }

    const acct = await activeAccount(est.orgId);
    if (!acct || !acct.chargesEnabled) {
      return res.status(503).json({ message: "Online payment isn't set up yet. Please contact us to arrange payment." });
    }
    if (!stripe) return res.status(503).json({ message: "Payments are not configured." });

    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, est.orgId)).limit(1);
    const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, est.customerId)).limit(1);

    // ACH listed first so it is the default choice — it is 100× cheaper on a
    // large deposit and is the whole reason this exists.
    const methods: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] = [];
    if (acct.achEnabled) methods.push("us_bank_account");
    if (acct.cardEnabled) methods.push("card");
    if (!methods.length) methods.push("card");

    const base = getBaseUrl(req);
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: methods,
        customer_email: cust?.email ?? undefined,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: est.orgId ? (acct.defaultCurrency || "usd") : "usd",
            unit_amount: amount,
            product_data: {
              name: `${est.depositCents ? "Deposit" : "Payment"} — ${est.title}${est.number ? ` (${est.number})` : ""}`,
              description: org?.name ? `Payable to ${org.name}` : undefined,
            },
          },
        }],
        success_url: `${base}/e/${t}?paid=1`,
        cancel_url: `${base}/e/${t}?paid=0`,
        // application_fee_amount omitted entirely: we take nothing.
        metadata: { estimateId: est.id, orgId: est.orgId, customerId: est.customerId },
      }, { stripeAccount: acct.externalAccountId }); // ← direct charge on THEIR account

      await db.insert(crmPayments).values({
        orgId: est.orgId, customerId: est.customerId, estimateId: est.id,
        projectId: est.projectId ?? null, provider: "stripe",
        externalId: session.id, purpose: est.depositCents ? "deposit" : "final",
        amountCents: amount, currency: acct.defaultCurrency || "usd",
        method: acct.achEnabled ? "ach" : "card", status: "pending",
        applicationFeeCents: 0,
      } as any);

      res.json({ url: session.url, amountCents: amount, achAvailable: acct.achEnabled });
    } catch (e: any) {
      console.error("[crm] checkout session failed:", e?.message || e);
      res.status(502).json({ message: String(e?.message || "Could not start checkout").slice(0, 200) });
    }
  });
}
