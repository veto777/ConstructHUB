/**
 * Account billing history — the Invoices / Payment methods / Purchases tabs.
 *
 *   GET /api/billing/invoices?limit=&starting_after=  { invoices, hasMore }
 *   GET /api/billing/payment-methods                   { methods }
 *   GET /api/billing/purchases?limit=&starting_after=  { purchases, hasMore }
 *
 * Invoices and purchases are read from the local ledgers (billing_invoices,
 * billing_purchases — kept current by the Stripe webhook). An account with NO
 * ledger rows yet (a customer from before the ledgers existed) is backfilled
 * once from Stripe, under the account's billing lock, and only when a Stripe
 * key is configured; without one the (empty) ledger is the honest answer, since
 * nothing could have been billed. Payment methods are never stored here: the
 * card list comes from Stripe on every call.
 *
 * Every read is scoped to the signed-in account's user id — the cursor of a
 * page is resolved inside that scope too, so another account's invoice id is
 * an unknown cursor (400), never a window into its rows. The agency seat
 * rewrite (server/agency/middleware.ts) applies only to location routes, so
 * the account here is always the one that pays.
 *
 * Nothing in this file is written on behalf of the client: amounts, statuses,
 * receipt and invoice URLs all come from Stripe or from rows the webhook
 * wrote from Stripe events.
 */
import type Stripe from "stripe";
import type { Express, Request, Response } from "express";
import { pool } from "../db";
import { stripe, stripeConfigured } from "../billing/client";
import { withBillingLock } from "../billing/sync";

type Auth = (req: any, res: any) => any;

/** Rows per page: the default and the ceiling (Stripe's own list ceiling). */
export const PAGE_DEFAULT = 20;
export const PAGE_MAX = 100;
/** How many Stripe pages (of 100) a backfill walks before it stops. */
const BACKFILL_PAGES = 10;
/** An account whose backfill found nothing is not asked again for this long. */
const BACKFILL_RECHECK_MS = 10 * 60_000;

// ---------------------------------------------------------------------------
// Schema — the ledgers this file reads are defined ONCE in
// server/account/schema.ts (BILLING_LEDGER_DDL); it is re-run here lazily so
// the routes work even before the boot-time ensureAccountSchema() (IF NOT
// EXISTS throughout: a second run is a no-op).
// ---------------------------------------------------------------------------
export { BILLING_LEDGER_DDL } from "./schema";
import { BILLING_LEDGER_DDL } from "./schema";

let ledgerReady: Promise<void> | null = null;
/** Creates the ledgers once per process; a failure is retried on the next call. */
export function ensureBillingLedgerSchema(): Promise<void> {
  ledgerReady ??= (async () => {
    for (const statement of BILLING_LEDGER_DDL) await pool.query(statement);
  })().catch((e: any) => {
    ledgerReady = null;
    throw e;
  });
  return ledgerReady;
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------
export class BillingReadError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = "BillingReadError";
  }
}

const CURSOR = /^[A-Za-z0-9_]{1,128}$/;

/** `?limit=` clamped to 1..PAGE_MAX (default PAGE_DEFAULT); `?starting_after=` a Stripe-style id or absent. */
export function parsePage(query: Record<string, unknown>): { limit: number; startingAfter: string | null } {
  const raw = Number.parseInt(String(query.limit ?? ""), 10);
  const limit = Number.isFinite(raw) ? Math.min(PAGE_MAX, Math.max(1, raw)) : PAGE_DEFAULT;
  const cursor = query.starting_after;
  if (cursor === undefined || cursor === null || cursor === "") return { limit, startingAfter: null };
  if (typeof cursor !== "string" || !CURSOR.test(cursor)) {
    throw new BillingReadError(400, "That page cursor isn't valid.", "bad_cursor");
  }
  return { limit, startingAfter: cursor };
}

const iso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const epochToDate = (epoch: unknown): Date | null =>
  typeof epoch === "number" && Number.isFinite(epoch) ? new Date(epoch * 1000) : null;
const idOf = (ref: unknown): string | null =>
  typeof ref === "string" ? ref : ref && typeof ref === "object" && typeof (ref as any).id === "string" ? (ref as any).id : null;

// ---------------------------------------------------------------------------
// Keyset pagination over a ledger, newest first, inside one account.
// ---------------------------------------------------------------------------
// The sort key. `created` is nullable in the shared DDL (a writer that omits it
// is a bug, but a NULL must not make a page vanish): a row without one sorts
// last, and pages past it consistently.
const SORT_CREATED = `COALESCE(created, 'epoch'::timestamptz)`;

async function pageOf<T extends { id: string }>(
  table: "billing_invoices" | "billing_purchases", userId: number, page: { limit: number; startingAfter: string | null },
): Promise<{ rows: T[]; hasMore: boolean }> {
  const values: unknown[] = [userId, page.limit + 1];
  let after = "";
  if (page.startingAfter) {
    // The cursor must be one of THIS account's rows: resolved under user_id,
    // so an id from another account (or a made-up one) is simply unknown.
    const { rows: [cursor] } = await pool.query(
      `SELECT 1 FROM ${table} WHERE user_id = $1 AND id = $2`, [userId, page.startingAfter]);
    if (!cursor) throw new BillingReadError(400, "That page cursor isn't one of your records.", "bad_cursor");
    values.push(page.startingAfter);
    // The cursor row's sort key is read inside the query, at Postgres' own
    // microsecond precision: a round trip through a JS Date keeps only
    // milliseconds, and rows written in the same millisecond as the cursor
    // (but a few microseconds earlier) would be skipped between pages.
    after = `AND (${SORT_CREATED}, id) < (SELECT ${SORT_CREATED}, id FROM ${table} WHERE user_id = $1 AND id = $3)`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM ${table} WHERE user_id = $1 ${after} ORDER BY ${SORT_CREATED} DESC, id DESC LIMIT $2`, values);
  return { rows: rows.slice(0, page.limit) as T[], hasMore: rows.length > page.limit };
}

async function ledgerCount(table: "billing_invoices" | "billing_purchases", userId: number): Promise<number> {
  const { rows: [r] } = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [userId]);
  return r?.n ?? 0;
}

async function billingRefsFor(userId: number): Promise<{ customerId: string | null; subscriptionId: string | null }> {
  const { rows: [r] } = await pool.query(
    `SELECT stripe_customer_id, stripe_subscription_id FROM subscriptions WHERE user_id = $1 ORDER BY id LIMIT 1`, [userId]);
  return { customerId: r?.stripe_customer_id ?? null, subscriptionId: r?.stripe_subscription_id ?? null };
}
const customerIdFor = async (userId: number) => (await billingRefsFor(userId)).customerId;

/** Stripe's "No such …" for the id we asked about (resource_missing). */
const isMissingResource = (err: any) => typeof err?.type === "string" && err.type.startsWith("Stripe") && err?.code === "resource_missing";
/**
 * Stripe's "No such customer": the stored id is not in the connected Stripe
 * account (a test-mode customer under the live key, or one deleted there).
 * Nothing can have been billed to it through this key, so the honest answer
 * is "no records" — logged, because it is a configuration smell — rather than
 * a 502 on every load of the Billing page for as long as the row exists.
 */
const isMissingCustomer = (err: any) =>
  isMissingResource(err) && (err?.param === "customer" || /no such customer/i.test(String(err?.message ?? "")));
const warnMissingCustomer = (what: string, userId: number, customer: string) =>
  console.warn(`[billing] Stripe has no customer ${customer} (user ${userId}); ${what} read as empty`);

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
export type InvoiceItem = {
  id: string; number: string | null; status: string | null; amountPaid: number | null; amountDue: number | null;
  currency: string | null; created: string | null; periodStart: string | null; periodEnd: string | null;
  description: string | null; hostedInvoiceUrl: string | null; invoicePdf: string | null;
};

export const invoiceItem = (r: any): InvoiceItem => ({
  id: r.id, number: r.number ?? null, status: r.status ?? null,
  amountPaid: r.amount_paid ?? null, amountDue: r.amount_due ?? null, currency: r.currency ?? null,
  created: iso(r.created), periodStart: iso(r.period_start), periodEnd: iso(r.period_end),
  description: r.description ?? null, hostedInvoiceUrl: r.hosted_invoice_url ?? null, invoicePdf: r.invoice_pdf ?? null,
});

/** What a Stripe invoice stores as a ledger row. A draft is not billed yet (no number, no page) and is skipped. */
export function invoiceRow(userId: number, inv: Stripe.Invoice): Record<string, unknown> | null {
  if (!inv?.id || inv.status === "draft") return null;
  const lines = (inv.lines?.data ?? []).map((l) => l.description).filter((d): d is string => !!d);
  return {
    id: inv.id, user_id: userId, number: inv.number ?? null, status: inv.status ?? null,
    amount_paid: inv.amount_paid ?? null, amount_due: inv.amount_due ?? null, currency: inv.currency ?? null,
    period_start: epochToDate(inv.period_start), period_end: epochToDate(inv.period_end),
    description: inv.description ?? (lines.length ? lines.join(", ") : null),
    hosted_invoice_url: inv.hosted_invoice_url ?? null, invoice_pdf: inv.invoice_pdf ?? null,
    created: epochToDate(inv.created) ?? new Date(),
  };
}

async function upsertInvoice(row: Record<string, unknown>) {
  await pool.query(
    `INSERT INTO billing_invoices (id, user_id, number, status, amount_paid, amount_due, currency, period_start, period_end,
       description, hosted_invoice_url, invoice_pdf, created)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET number = EXCLUDED.number, status = EXCLUDED.status, amount_paid = EXCLUDED.amount_paid,
       amount_due = EXCLUDED.amount_due, hosted_invoice_url = EXCLUDED.hosted_invoice_url, invoice_pdf = EXCLUDED.invoice_pdf
     WHERE billing_invoices.user_id = EXCLUDED.user_id`,
    [row.id, row.user_id, row.number, row.status, row.amount_paid, row.amount_due, row.currency, row.period_start,
      row.period_end, row.description, row.hosted_invoice_url, row.invoice_pdf, row.created]);
}

const backfillChecked = new Map<string, number>();
const recentlyChecked = (key: string) => (backfillChecked.get(key) ?? 0) > Date.now() - BACKFILL_RECHECK_MS;

/**
 * An account with no invoice rows yet gets its Stripe invoices copied in
 * once. Runs under the account's billing lock so two first loads (two tabs)
 * don't both walk Stripe; the upsert keeps a repeat harmless anyway.
 */
export async function backfillInvoices(userId: number): Promise<number> {
  const key = `invoices:${userId}`;
  if (!stripeConfigured() || recentlyChecked(key)) return 0;
  return withBillingLock(userId, async () => {
    if (recentlyChecked(key) || (await ledgerCount("billing_invoices", userId)) > 0) return 0;
    const customer = await customerIdFor(userId);
    if (!customer) { backfillChecked.set(key, Date.now()); return 0; }
    let copied = 0;
    let starting_after: string | undefined;
    try {
      for (let page = 0; page < BACKFILL_PAGES; page++) {
        const list = await stripe.invoices.list({ customer, limit: 100, ...(starting_after ? { starting_after } : {}) });
        for (const inv of list.data) {
          const row = invoiceRow(userId, inv);
          if (row) { await upsertInvoice(row); copied++; }
        }
        if (!list.has_more || !list.data.length) break;
        starting_after = list.data[list.data.length - 1].id;
      }
    } catch (err) {
      if (!isMissingCustomer(err)) throw err;
      warnMissingCustomer("invoices", userId, customer);
    }
    backfillChecked.set(key, Date.now());
    return copied;
  });
}

// ---------------------------------------------------------------------------
// Purchases (one-off checkouts: courses, services, reinstatements)
// ---------------------------------------------------------------------------
export type PurchaseKind = "course" | "service" | "reinstatement" | "other";
export type PurchaseItem = {
  id: string; kind: PurchaseKind | string | null; description: string | null; amount: number | null;
  currency: string | null; created: string | null; receiptUrl: string | null;
};

export const purchaseItem = (r: any): PurchaseItem => ({
  id: r.id, kind: r.kind ?? null, description: r.description ?? null, amount: r.amount ?? null,
  currency: r.currency ?? null, created: iso(r.created), receiptUrl: r.receipt_url ?? null,
});

/** The kind of a paid checkout, from the metadata our own checkout routes set (server/stripe.ts). */
export function purchaseKind(metadata: Record<string, string> | null | undefined): PurchaseKind {
  const type = metadata?.type;
  if (type === "master_class") return "course";
  if (type === "reinstatement") return "reinstatement";
  if (type === "cart") {
    let items: any[] = [];
    try { items = JSON.parse(metadata?.items || "[]"); } catch { items = []; }
    const kinds = new Set(items.map((i) => (String(i?.type ?? "").startsWith("course") ? "course"
      : String(i?.type ?? "").startsWith("dfy") ? "service" : "other")));
    if (kinds.size === 1) return [...kinds][0] as PurchaseKind;
    return "other";
  }
  return "other";
}

/** What a completed, paid, one-off checkout stores as a ledger row; null for anything else (plans, unpaid, free). */
export function purchaseRow(userId: number, session: Stripe.Checkout.Session): Record<string, unknown> | null {
  if (!session?.id || session.mode !== "payment" || session.payment_status !== "paid") return null;
  if (typeof session.amount_total !== "number") return null;
  const lineItems = ((session as any).line_items?.data ?? []) as Stripe.LineItem[];
  let description: string | null = lineItems.map((l) => l.description).filter(Boolean).join(", ") || null;
  if (!description && session.metadata?.type === "cart") {
    try {
      const names = (JSON.parse(session.metadata.items || "[]") as any[]).map((i) => i?.name).filter((n) => typeof n === "string");
      description = names.length ? names.join(", ") : null;
    } catch { description = null; }
  }
  const intent = session.payment_intent;
  const charge = intent && typeof intent === "object" ? (intent as Stripe.PaymentIntent).latest_charge : null;
  const receipt = charge && typeof charge === "object" ? (charge as Stripe.Charge).receipt_url ?? null : null;
  return {
    id: session.id, user_id: userId, kind: purchaseKind(session.metadata), description,
    amount: session.amount_total, currency: session.currency ?? null,
    created: epochToDate(session.created) ?? new Date(), receipt_url: receipt,
  };
}

async function insertPurchase(row: Record<string, unknown>) {
  // The webhook's row (written from the event) wins over a backfilled copy.
  await pool.query(
    `INSERT INTO billing_purchases (id, user_id, kind, description, amount, currency, created, receipt_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
    [row.id, row.user_id, row.kind, row.description, row.amount, row.currency, row.created, row.receipt_url]);
}

/** Same rule as backfillInvoices, for one-off checkouts. */
export async function backfillPurchases(userId: number): Promise<number> {
  const key = `purchases:${userId}`;
  if (!stripeConfigured() || recentlyChecked(key)) return 0;
  return withBillingLock(userId, async () => {
    if (recentlyChecked(key) || (await ledgerCount("billing_purchases", userId)) > 0) return 0;
    const customer = await customerIdFor(userId);
    if (!customer) { backfillChecked.set(key, Date.now()); return 0; }
    let copied = 0;
    let starting_after: string | undefined;
    try {
      for (let page = 0; page < BACKFILL_PAGES; page++) {
        const list = await stripe.checkout.sessions.list({
          customer, status: "complete", limit: 100,
          expand: ["data.line_items", "data.payment_intent.latest_charge"],
          ...(starting_after ? { starting_after } : {}),
        });
        for (const session of list.data) {
          const row = purchaseRow(userId, session);
          if (row) { await insertPurchase(row); copied++; }
        }
        if (!list.has_more || !list.data.length) break;
        starting_after = list.data[list.data.length - 1].id;
      }
    } catch (err) {
      if (!isMissingCustomer(err)) throw err;
      warnMissingCustomer("purchases", userId, customer);
    }
    backfillChecked.set(key, Date.now());
    return copied;
  });
}

/** Tests: forget which accounts were already checked against Stripe. */
export function resetBackfillMemory() { backfillChecked.clear(); }

// ---------------------------------------------------------------------------
// Payment methods — straight from Stripe, never stored.
// ---------------------------------------------------------------------------
export type PaymentMethodItem = {
  id: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; isDefault: boolean;
};

export function paymentMethodItem(pm: Stripe.PaymentMethod, defaultId: string | null): PaymentMethodItem {
  const card = pm.card ?? null;
  const bank = (pm as any).us_bank_account ?? null;
  return {
    id: pm.id,
    brand: card?.brand ?? bank?.bank_name ?? (pm.type ? String(pm.type).replace(/_/g, " ") : null),
    last4: card?.last4 ?? bank?.last4 ?? null,
    expMonth: card?.exp_month ?? null,
    expYear: card?.exp_year ?? null,
    isDefault: !!defaultId && pm.id === defaultId,
  };
}

/**
 * The method a current subscription charges: Stripe uses the subscription's
 * own default_payment_method ahead of the customer's invoice_settings — and
 * Checkout sets only the former, so for most subscribers the customer-level
 * default is empty. A subscription Stripe no longer has, or one that ended, is
 * no default (the customer-level one applies instead).
 */
async function subscriptionDefaultMethod(subscriptionId: string | null): Promise<string | null> {
  if (!subscriptionId) return null;
  try {
    const sub = (await stripe.subscriptions.retrieve(subscriptionId)) as Stripe.Subscription | null | undefined;
    if (!sub || sub.status === "canceled" || sub.status === "incomplete_expired") return null;
    return idOf(sub.default_payment_method) ?? idOf(sub.default_source);
  } catch (err) {
    if (isMissingResource(err)) return null;
    throw err;
  }
}

export async function listPaymentMethods(userId: number): Promise<PaymentMethodItem[]> {
  if (!stripeConfigured()) return [];
  const { customerId, subscriptionId } = await billingRefsFor(userId);
  if (!customerId) return [];
  let customer: Stripe.Customer | Stripe.DeletedCustomer, methods: { data: Stripe.PaymentMethod[] }, subscriptionDefault: string | null;
  try {
    [customer, methods, subscriptionDefault] = await Promise.all([
      stripe.customers.retrieve(customerId),
      stripe.customers.listPaymentMethods(customerId, { limit: 100 }),
      subscriptionDefaultMethod(subscriptionId),
    ]);
  } catch (err) {
    if (!isMissingCustomer(err)) throw err;
    warnMissingCustomer("payment methods", userId, customerId);
    return [];
  }
  if (!customer || (customer as Stripe.DeletedCustomer).deleted) return [];
  const settings = (customer as Stripe.Customer).invoice_settings;
  const defaultId = subscriptionDefault
    ?? idOf(settings?.default_payment_method) ?? idOf((customer as Stripe.Customer).default_source);
  return methods.data.map((pm) => paymentMethodItem(pm, defaultId));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
/** A failed read: our own 400s as they are; a Stripe failure as 502 (nothing is made up to fill the gap). */
function sendBillingReadError(res: Response, err: any) {
  if (err instanceof BillingReadError) {
    return res.status(err.status).json(err.code ? { code: err.code, message: err.message } : { message: err.message });
  }
  if (typeof err?.type === "string" && err.type.startsWith("Stripe")) {
    console.error("[billing] Stripe read failed:", err.type, err.code ?? "", err.message ?? "");
    return res.status(502).json({ code: "provider_unavailable", message: "Billing records couldn't be loaded from the payment provider right now. Please try again in a moment." });
  }
  console.error("[billing] read failed:", err?.message ?? err);
  return res.status(500).json({ message: "Billing records couldn't be loaded. Please try again." });
}

export function registerBillingRoutes(app: Express, auth: Auth) {
  void ensureBillingLedgerSchema().catch((e: any) => console.error("[billing] ledger schema:", e?.message ?? e));

  app.get("/api/billing/invoices", async (req: Request, res: Response) => {
    try {
      const user = auth(req, res); if (!user) return;
      const page = parsePage(req.query as Record<string, unknown>);
      await ensureBillingLedgerSchema();
      if (!page.startingAfter) await backfillInvoices(user.id);
      const { rows, hasMore } = await pageOf<any>("billing_invoices", user.id, page);
      res.json({ invoices: rows.map(invoiceItem), hasMore });
    } catch (err: any) {
      sendBillingReadError(res, err);
    }
  });

  app.get("/api/billing/payment-methods", async (req: Request, res: Response) => {
    try {
      const user = auth(req, res); if (!user) return;
      res.json({ methods: await listPaymentMethods(user.id) });
    } catch (err: any) {
      sendBillingReadError(res, err);
    }
  });

  app.get("/api/billing/purchases", async (req: Request, res: Response) => {
    try {
      const user = auth(req, res); if (!user) return;
      const page = parsePage(req.query as Record<string, unknown>);
      await ensureBillingLedgerSchema();
      if (!page.startingAfter) await backfillPurchases(user.id);
      const { rows, hasMore } = await pageOf<any>("billing_purchases", user.id, page);
      res.json({ purchases: rows.map(purchaseItem), hasMore });
    } catch (err: any) {
      sendBillingReadError(res, err);
    }
  });
}
