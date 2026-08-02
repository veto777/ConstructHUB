/**
 * The plumbing that makes the money path and the public API real:
 *   1. A Stripe **Connect** webhook that reconciles crm_payments. Connected-
 *      account events do NOT arrive on the platform endpoint, so this is a
 *      separate route with its own signing secret.
 *   2. Outbound webhook dispatch — HMAC-signed, with retry/backoff.
 *   3. API-key authentication for the public read API.
 */
import type { Express, RequestHandler } from "express";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { isIP } from "net";
import { lookup } from "dns/promises";
import Stripe from "stripe";
import { db } from "../db";
import {
  crmPayments, crmInvoices, crmEstimates, crmProjects, crmCustomers, crmOrgs,
  crmApiKeys, crmWebhooks, crmMembers, crmEstimateEvents, crmPaymentAccounts,
  crmNotificationEnabled,
} from "@shared/schema";
import { and, eq, desc, sql, isNull } from "drizzle-orm";
import { sendWithFallback } from "../email";
import { autoSendPaymentReceipt } from "./receipts";
import { textOrgOwners } from "./sms";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const CONNECT_WEBHOOK_SECRET = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY) : null;

// ── SSRF guard for outbound webhooks ────────────────────────────────────────
// A webhook URL is tenant-controlled and we fetch it server-side, so it must
// never resolve to a loopback/private/link-local address (cloud metadata at
// 169.254.169.254 is the classic target). Hostname checks alone are not
// enough: Node's URL parser accepts IPv4-mapped IPv6 ("[::ffff:7f00:1]"),
// "0.0.0.0", ULA and link-local literals, and a public hostname can simply
// resolve to a private address. So: parse the IP properly, and resolve DNS —
// at registration time AND again at delivery time (rebinding between the two
// is a real attack).

/** Unwrap an IPv4-mapped IPv6 address to its IPv4 form. Node's URL parser
 *  canonicalises "[::ffff:127.0.0.1]" to the hex form "::ffff:7f00:1", so
 *  both spellings must be recognised. */
function unmapV4(ip: string): string {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return ip;
}

export function isPrivateIp(raw: string): boolean {
  const ip = unmapV4(raw.trim().toLowerCase());
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||           // link-local, incl. cloud metadata
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      a >= 224                              // multicast / reserved / broadcast
    );
  }
  return (
    ip === "::1" || ip === "::" ||
    ip.startsWith("fe80:") ||                     // link-local
    ip.startsWith("fc") || ip.startsWith("fd")    // unique-local (fc00::/7)
  );
}

/** True only when the URL is http(s) and every resolved address is public. */
export async function webhookUrlIsSafe(url: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return false;
  if (isIP(host)) return !isPrivateIp(host);
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  try {
    const addrs = await lookup(host, { all: true, verbatim: true });
    if (!addrs.length) return false;
    return addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false; // unresolvable — refuse rather than fail open
  }
}

// ── Outbound webhooks ───────────────────────────────────────────────────────

/**
 * Fire an event to every subscriber. Signed the way Stripe signs: an
 * `t=<unix>,v1=<hmac>` header over `<t>.<body>` so replays can be rejected.
 * Never throws — a failing customer endpoint must not break our request.
 */
export async function emitCrmEvent(orgId: string, event: string, payload: any): Promise<void> {
  try {
    const hooks = await db.select().from(crmWebhooks)
      .where(and(eq(crmWebhooks.orgId, orgId), eq(crmWebhooks.active, true)));
    const targets = hooks.filter((h) => (h.events || []).includes(event));
    if (!targets.length) return;

    const body = JSON.stringify({
      event, orgId, occurredAt: new Date().toISOString(), data: payload,
    });

    await Promise.all(targets.map(async (h) => {
      const ts = Math.floor(Date.now() / 1000);
      const sig = createHmac("sha256", h.secret).update(`${ts}.${body}`).digest("hex");
      let lastStatus = 0;
      // Re-resolve at delivery time: DNS may have been rebound since registration.
      if (!(await webhookUrlIsSafe(h.url))) {
        await db.update(crmWebhooks).set({
          lastStatus: 0, lastAttemptAt: new Date(),
          failureCount: (h.failureCount ?? 0) + 1,
          active: (h.failureCount ?? 0) + 1 < 20,
        }).where(eq(crmWebhooks.id, h.id)).catch(() => {});
        return;
      }
      // Three tries with backoff. Beyond that we record the failure and stop —
      // a dead endpoint shouldn't be retried forever.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 8000);
          const r = await fetch(h.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "ConstructHUB-Signature": `t=${ts},v1=${sig}`,
              "ConstructHUB-Event": event,
            },
            body, signal: ctl.signal,
          });
          clearTimeout(timer);
          lastStatus = r.status;
          if (r.ok) break;
        } catch {
          lastStatus = 0;
        }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * Math.pow(3, attempt)));
      }
      await db.update(crmWebhooks).set({
        lastStatus, lastAttemptAt: new Date(),
        failureCount: lastStatus >= 200 && lastStatus < 300 ? 0 : (h.failureCount ?? 0) + 1,
        // Auto-disable after sustained failure so we stop hammering dead URLs.
        active: (h.failureCount ?? 0) + 1 < 20,
      }).where(eq(crmWebhooks.id, h.id)).catch(() => {});
    }));
  } catch (e: any) {
    console.error("[crm] emitCrmEvent failed:", e?.message || e);
  }
}

// ── API-key auth for the public read API ────────────────────────────────────

export type ApiCtx = { orgId: string; keyId: string; scopes: string[] };

/** `Authorization: Bearer chk_…` → org context, or 401. */
export const requireApiKey: RequestHandler = async (req: any, res, next) => {
  const hdr = String(req.headers.authorization || "");
  const m = /^Bearer\s+(chk_[A-Za-z0-9]+)$/.exec(hdr.trim());
  if (!m) {
    return res.status(401).json({
      error: { message: "Provide an API key as: Authorization: Bearer chk_…" },
    });
  }
  const hash = createHash("sha256").update(m[1]).digest("hex");
  const [key] = await db.select().from(crmApiKeys)
    .where(and(eq(crmApiKeys.keyHash, hash), isNull(crmApiKeys.revokedAt))).limit(1);
  if (!key) return res.status(401).json({ error: { message: "Invalid or revoked API key." } });

  // Best-effort usage stamp.
  db.update(crmApiKeys).set({ lastUsedAt: new Date() }).where(eq(crmApiKeys.id, key.id)).catch(() => {});
  req.apiCtx = { orgId: key.orgId, keyId: key.id, scopes: key.scopes || ["read"] } as ApiCtx;
  next();
};

export function registerCrmIntegrationRoutes(app: Express): void {
  // ══ 1. Stripe CONNECT webhook — reconciles crm_payments ═══════════════════
  // Mounted on its own path with its own secret. Connected-account events never
  // arrive on the platform endpoint, which is why the existing
  // /api/stripe/webhook handler (cart/subscriptions) does not see these.

  app.post("/api/crm/stripe/connect-webhook", async (req: any, res) => {
    if (!stripe) return res.status(503).send("stripe not configured");
    if (!CONNECT_WEBHOOK_SECRET) {
      // Fail closed, loudly. An unverified webhook must never mutate money rows.
      console.error("STRIPE_CONNECT_WEBHOOK_SECRET is not set — rejecting Connect webhook.");
      return res.status(503).send("connect webhook secret not configured");
    }
    const sig = req.headers["stripe-signature"];
    if (!sig || !req.rawBody) return res.status(400).send("missing signature or raw body");

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, String(sig), CONNECT_WEBHOOK_SECRET);
    } catch (e: any) {
      console.error("[crm] connect webhook signature failed:", e?.message || e);
      return res.status(400).send(`signature verification failed`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
          const s = event.data.object as Stripe.Checkout.Session;
          // ACH settles asynchronously: `completed` can fire while the debit is
          // still processing, so only "paid" counts as money received.
          const settled = s.payment_status === "paid";
          await settlePayment(s.id, settled ? "succeeded" : "processing",
            typeof s.payment_intent === "string" ? s.payment_intent : undefined);
          break;
        }
        case "checkout.session.async_payment_failed":
        case "checkout.session.expired": {
          const s = event.data.object as Stripe.Checkout.Session;
          await settlePayment(s.id, event.type.endsWith("failed") ? "failed" : "canceled");
          break;
        }
        case "payment_intent.succeeded": {
          const pi = event.data.object as Stripe.PaymentIntent;
          await settleByIntent(pi.id, "succeeded");
          break;
        }
        case "payment_intent.payment_failed": {
          const pi = event.data.object as Stripe.PaymentIntent;
          await settleByIntent(pi.id, "failed",
            pi.last_payment_error?.message ?? null);
          break;
        }
        case "charge.refunded": {
          const ch = event.data.object as Stripe.Charge;
          if (typeof ch.payment_intent === "string") await settleByIntent(ch.payment_intent, "refunded");
          break;
        }
      }
    } catch (e: any) {
      console.error("[crm] connect webhook handler error:", e?.message || e);
      // 500 so Stripe retries rather than dropping the event.
      return res.status(500).send("handler error");
    }
    res.json({ received: true });
  });

  // ══ 2. Public read API (API-key authenticated) ════════════════════════════
  // Versioned from day one. Leap CRM's Zapier app has 3 triggers and 0 actions;
  // this is the wedge.

  app.get("/api/v1/ping", requireApiKey, (req: any, res) => {
    res.json({ ok: true, orgId: req.apiCtx.orgId, scopes: req.apiCtx.scopes });
  });

  const page = (req: any) => {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50")) || 50));
    const offset = Math.max(0, parseInt(String(req.query.offset || "0")) || 0);
    return { limit, offset };
  };
  /** One pagination envelope for every collection — HCP uses three. */
  const envelope = (data: any[], total: number, limit: number, offset: number) => ({
    data, pagination: { total, limit, offset, hasMore: offset + data.length < total },
  });

  app.get("/api/v1/customers", requireApiKey, async (req: any, res) => {
    const { limit, offset } = page(req);
    const org = req.apiCtx.orgId;
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(crmCustomers).where(eq(crmCustomers.orgId, org));
    const rows = await db.select().from(crmCustomers).where(eq(crmCustomers.orgId, org))
      .orderBy(desc(crmCustomers.createdAt)).limit(limit).offset(offset);
    // Portal tokens are credentials — never in an API response.
    res.json(envelope(rows.map(({ portalToken, ...c }) => c), total, limit, offset));
  });

  app.get("/api/v1/projects", requireApiKey, async (req: any, res) => {
    const { limit, offset } = page(req);
    const org = req.apiCtx.orgId;
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(crmProjects).where(eq(crmProjects.orgId, org));
    const rows = await db.select().from(crmProjects).where(eq(crmProjects.orgId, org))
      .orderBy(desc(crmProjects.createdAt)).limit(limit).offset(offset);
    res.json(envelope(rows, total, limit, offset));
  });

  app.get("/api/v1/estimates", requireApiKey, async (req: any, res) => {
    const { limit, offset } = page(req);
    const org = req.apiCtx.orgId;
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(crmEstimates).where(eq(crmEstimates.orgId, org));
    const rows = await db.select().from(crmEstimates).where(eq(crmEstimates.orgId, org))
      .orderBy(desc(crmEstimates.createdAt)).limit(limit).offset(offset);
    res.json(envelope(rows.map(({ publicToken, ...e }) => e), total, limit, offset));
  });

  app.get("/api/v1/invoices", requireApiKey, async (req: any, res) => {
    const { limit, offset } = page(req);
    const org = req.apiCtx.orgId;
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(crmInvoices).where(eq(crmInvoices.orgId, org));
    const rows = await db.select().from(crmInvoices).where(eq(crmInvoices.orgId, org))
      .orderBy(desc(crmInvoices.createdAt)).limit(limit).offset(offset);
    res.json(envelope(rows.map(({ publicToken, ...i }) => i), total, limit, offset));
  });

  app.get("/api/v1/payments", requireApiKey, async (req: any, res) => {
    const { limit, offset } = page(req);
    const org = req.apiCtx.orgId;
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(crmPayments).where(eq(crmPayments.orgId, org));
    const rows = await db.select().from(crmPayments).where(eq(crmPayments.orgId, org))
      .orderBy(desc(crmPayments.createdAt)).limit(limit).offset(offset);
    res.json(envelope(rows, total, limit, offset));
  });

  /** Machine-readable description of the API — the thing Leap never published. */
  app.get("/api/v1", (_req, res) => {
    res.json({
      name: "ConstructHub CRM Public API",
      version: "v1",
      auth: "Authorization: Bearer chk_… (create keys in Portal → Payments/Integrations)",
      pagination: "?limit=50&offset=0 — one envelope on every collection",
      resources: ["/api/v1/customers", "/api/v1/projects", "/api/v1/estimates",
                  "/api/v1/invoices", "/api/v1/payments"],
      webhooks: {
        signature: "ConstructHUB-Signature: t=<unix>,v1=<hex hmac-sha256 of `${t}.${body}`>",
        retries: "3 attempts with backoff; auto-disabled after 20 consecutive failures",
      },
    });
  });
}

/** Mark a payment settled by Checkout Session id, and cascade to the invoice. */
async function settlePayment(sessionId: string, status: string, intentId?: string) {
  const [pay] = await db.select().from(crmPayments)
    .where(eq(crmPayments.externalId, sessionId)).limit(1);
  if (!pay) {
    console.warn("[crm] connect webhook for unknown session", sessionId);
    return;
  }
  await applySettlement(pay, status, intentId);
}

async function settleByIntent(intentId: string, status: string, failure?: string | null) {
  const [pay] = await db.select().from(crmPayments)
    .where(eq(crmPayments.externalId, intentId)).limit(1);
  if (!pay) return; // the session-id row is the canonical one; nothing to do
  await applySettlement(pay, status, undefined, failure);
}

async function applySettlement(
  pay: typeof crmPayments.$inferSelect, status: string, intentId?: string, failure?: string | null,
) {
  // Idempotent: Stripe retries, and a succeeded payment must never regress.
  if (pay.status === "succeeded" && status !== "refunded") return;

  // The checkout record guessed the rail (ACH-first); the charge is the truth.
  // Resolve the actual method so the ledger and the "payment received" email
  // name what the client really paid with (Visa •••• 4242, bank ACH…).
  const actual = status === "succeeded"
    ? await resolveStripeMethod(intentId ?? pay.externalId, pay.orgId)
    : null;

  const [row] = await db.update(crmPayments).set({
    status,
    externalId: intentId ?? pay.externalId,
    failureReason: failure ?? null,
    paidAt: status === "succeeded" ? new Date() : null,
    ...(actual?.method ? { method: actual.method } : {}),
    updatedAt: new Date(),
  }).where(eq(crmPayments.id, pay.id)).returning();

  if (status !== "succeeded") {
    await emitCrmEvent(pay.orgId, "payment.failed", { paymentId: row.id, status, failure });
    return;
  }

  // Credit the invoice, if this payment was against one.
  if (pay.invoiceId) {
    const [inv] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, pay.invoiceId)).limit(1);
    if (inv) {
      const paid = (inv.paidCents ?? 0) + pay.amountCents;
      // Retainage is withheld, so "paid in full" means the due amount less retainage.
      const due = Math.max(0, inv.totalCents - (inv.retainageCents ?? 0));
      await db.update(crmInvoices).set({
        paidCents: paid,
        status: paid >= due ? "paid" : "partial",
        paidAt: paid >= due ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(crmInvoices.id, inv.id));
      if (paid >= due) await emitCrmEvent(pay.orgId, "invoice.paid", { invoiceId: inv.id, paidCents: paid });
      // Email the client their receipt-to-date (honors paymentReceipt).
      autoSendPaymentReceipt(pay.orgId, inv.id)
        .catch((e: any) => console.error("[crm] auto-receipt failed:", e?.message || e));
    }
  }

  if (pay.estimateId) {
    await db.insert(crmEstimateEvents).values({
      orgId: pay.orgId, estimateId: pay.estimateId, type: "paid", actor: "client",
      meta: { amountCents: pay.amountCents, method: pay.method },
    }).catch(() => {});
  }

  await emitCrmEvent(pay.orgId, "payment.succeeded", {
    paymentId: row.id, amountCents: row.amountCents, method: row.method,
    estimateId: row.estimateId, invoiceId: row.invoiceId, projectId: row.projectId,
  });

  await notifyPaid(pay, actual?.detail ?? null).catch(() => {});
}

/**
 * What the client actually paid with, from the PaymentIntent's latest charge
 * on the CONNECTED account (direct charge — platform reads need stripeAccount).
 * Best-effort: null on any failure, the settlement must never depend on it.
 */
async function resolveStripeMethod(
  intentId: string | null | undefined, orgId: string,
): Promise<{ method: "card" | "ach" | null; detail: string } | null> {
  if (!stripe || !intentId) return null;
  try {
    const [acct] = await db.select().from(crmPaymentAccounts)
      .where(and(eq(crmPaymentAccounts.orgId, orgId), isNull(crmPaymentAccounts.disconnectedAt)))
      .orderBy(desc(crmPaymentAccounts.createdAt)).limit(1);
    if (!acct) return null;
    const pi = await stripe.paymentIntents.retrieve(intentId,
      { expand: ["latest_charge"] }, { stripeAccount: acct.externalAccountId });
    const ch = typeof pi.latest_charge === "object" ? pi.latest_charge as Stripe.Charge : null;
    const pmd = ch?.payment_method_details;
    if (!pmd) return null;
    if (pmd.type === "card" && pmd.card) {
      const brand = (pmd.card.brand ?? "card").replace(/^\w/, (c) => c.toUpperCase());
      return { method: "card", detail: `${brand} •••• ${pmd.card.last4 ?? "????"}` };
    }
    if (pmd.type === "us_bank_account") {
      const b = pmd.us_bank_account;
      return {
        method: "ach",
        detail: `bank transfer (ACH)${b?.bank_name ? ` — ${b.bank_name}` : ""}${b?.last4 ? ` •••• ${b.last4}` : ""}`,
      };
    }
    return { method: null, detail: pmd.type };
  } catch (e: any) {
    console.error("[crm] resolveStripeMethod failed:", e?.message || e);
    return null;
  }
}

/** Tell the contractor money landed. `methodDetail` names the real rail
 *  ("Visa •••• 4242", "bank transfer (ACH) — Chase •••• 6789") when known. */
async function notifyPaid(pay: typeof crmPayments.$inferSelect, methodDetail: string | null = null) {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, pay.orgId)).limit(1);
  // The org can silence this notification in Settings (default: on).
  if (!crmNotificationEnabled(org?.customFields, "invoicePaid")) return;
  const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, pay.customerId)).limit(1);
  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, pay.orgId), eq(crmMembers.status, "active")));
  const to = new Set<string>();
  if (org?.email) to.add(org.email);
  for (const m of members) if (m.role === "owner" && m.email) to.add(m.email);
  if (!to.size) return;
  const amount = `$${(pay.amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const via = methodDetail ? ` via ${methodDetail}` : pay.method === "ach" ? " by bank transfer (ACH)" : " by card";
  await sendWithFallback({
    to: [...to].join(","),
    subject: `💰 ${amount} received from ${cust?.displayName ?? "a client"}`,
    html: `<p><strong>${amount}</strong> received from ${cust?.displayName ?? "a client"}${via}.</p>` +
          `<p>Paid directly into your own Stripe account.</p>`,
  } as any);

  // Money landing is worth a buzz in the pocket — opt-in per org.
  if (org) {
    await textOrgOwners(org, `${org.name}: ${amount} received from ${cust?.displayName ?? "a client"}${via}.`);
  }
}
