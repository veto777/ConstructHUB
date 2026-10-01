/**
 * Stripe invoices and one-time purchases → ledger rows (server/billing/ledger.ts).
 *
 *   invoiceRowFromStripe(inv, userId)   — the row for a Stripe invoice
 *   resolveInvoiceUserId(inv)           — whose invoice it is (customer id → subscriptions row)
 *   purchaseRowFromSession(session, u)  — the row for a paid one-time Checkout Session
 *   listInvoicesFromStripe(userId)      — backfill: every invoice of the account's
 *                                         own Stripe customer, upserted locally
 *   ensureInvoicesBackfilled(userId)    — run that once for an account with no local rows
 *   listPurchasesFromStripe(userId)     — the same for one-time checkouts
 *
 * Tenant isolation: the backfill only ever asks Stripe for the customer id
 * stored on the account's own `subscriptions` row, and a webhook invoice is
 * attributed by that same customer id (our own checkout metadata is only a
 * fallback). Nothing is guessed: an absent Stripe value is stored as NULL.
 */
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { masterClassModules } from "@shared/schema";
import { stripe, stripeConfigured } from "./client";
import { countLocalInvoices, upsertInvoice, upsertPurchase, type BillingInvoiceRow, type BillingPurchaseRow, type PurchaseKind } from "./ledger";

export const epochToDate = (epoch: unknown): Date | null =>
  typeof epoch === "number" && Number.isFinite(epoch) ? new Date(epoch * 1000) : null;

/** A Stripe reference is an id or the expanded object. */
export const idOf = (ref: unknown): string | null =>
  typeof ref === "string" ? ref : ref && typeof ref === "object" && typeof (ref as any).id === "string" ? (ref as any).id : null;

const positiveInt = (raw: unknown): number | null => {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ---------------------------------------------------------------------------
// Whose Stripe object is it

export async function userIdForCustomer(customerId: string | null): Promise<number | null> {
  if (!customerId) return null;
  const { rows: [r] } = await pool.query(
    `SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1 ORDER BY id LIMIT 1`, [customerId]);
  return positiveInt(r?.user_id);
}

export async function customerIdForUser(userId: number): Promise<string | null> {
  const { rows: [r] } = await pool.query(
    `SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 AND stripe_customer_id IS NOT NULL ORDER BY id LIMIT 1`, [userId]);
  return typeof r?.stripe_customer_id === "string" ? r.stripe_customer_id : null;
}

/** The subscription an invoice bills (the 2025 `parent.subscription_details` shape, or the legacy top-level field). */
export function invoiceSubscriptionId(inv: Stripe.Invoice): string | null {
  const any = inv as any;
  return idOf(any.parent?.subscription_details?.subscription) ?? idOf(any.subscription);
}

/** The account id our checkout wrote into the subscription's metadata (snapshotted on its invoices), if any. */
export function invoiceUserIdHint(inv: Stripe.Invoice): number | null {
  const any = inv as any;
  return positiveInt(any.parent?.subscription_details?.metadata?.userId)
    ?? positiveInt(any.subscription_details?.metadata?.userId)
    ?? positiveInt(inv.metadata?.userId);
}

/** The customer id is authoritative (we created it for exactly one account); metadata is the fallback. */
export async function resolveInvoiceUserId(inv: Stripe.Invoice): Promise<number | null> {
  return (await userIdForCustomer(idOf(inv.customer))) ?? invoiceUserIdHint(inv);
}

/** The account a Checkout Session was started for: our own metadata first, else the customer's account. */
export async function resolveSessionUserId(session: Stripe.Checkout.Session): Promise<number | null> {
  return positiveInt(session.metadata?.userId) ?? (await userIdForCustomer(idOf(session.customer)));
}

// ---------------------------------------------------------------------------
// Invoices

/** What the invoice was for: Stripe's own description, else its line items' descriptions. */
export function invoiceDescription(inv: Stripe.Invoice): string | null {
  if (inv.description) return inv.description.slice(0, 1000);
  const lines = (inv.lines?.data ?? []).map((line) => line.description).filter((d): d is string => !!d);
  return lines.length ? lines.join("; ").slice(0, 1000) : null;
}

export function invoiceRowFromStripe(inv: Stripe.Invoice, userId: number): BillingInvoiceRow {
  return {
    id: inv.id,
    userId,
    number: inv.number ?? null,
    status: inv.status ?? null,
    amountPaid: inv.amount_paid ?? 0,
    amountDue: inv.amount_due ?? 0,
    currency: inv.currency ?? "usd",
    periodStart: epochToDate(inv.period_start),
    periodEnd: epochToDate(inv.period_end),
    description: invoiceDescription(inv),
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdf: inv.invoice_pdf ?? null,
    created: epochToDate(inv.created) ?? new Date(),
  };
}

const BACKFILL_PAGE = 100;
const BACKFILL_MAX_PAGES = 10;

/**
 * Every (non-draft) invoice Stripe holds for the account's own customer,
 * upserted into billing_invoices and returned newest first. For accounts that
 * paid before the ledger existed; the webhook keeps everyone else current.
 * No customer id (never checked out) → nothing to fetch.
 */
export async function listInvoicesFromStripe(userId: number): Promise<BillingInvoiceRow[]> {
  const customerId = await customerIdForUser(userId);
  if (!customerId) return [];
  const rows: BillingInvoiceRow[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < BACKFILL_MAX_PAGES; page++) {
    const res = await stripe.invoices.list({
      customer: customerId, limit: BACKFILL_PAGE, ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const inv of res.data) {
      // A draft is not an invoice yet (no number, no PDF); it arrives via invoice.finalized.
      if (inv.status === "draft") continue;
      const row = invoiceRowFromStripe(inv, userId);
      await upsertInvoice(row);
      rows.push(row);
    }
    if (!res.has_more || !res.data.length) break;
    startingAfter = res.data[res.data.length - 1].id;
  }
  return rows;
}

const BACKFILL_MEMO_MS = 10 * 60_000;
const backfillChecked = new Map<number, number>();

/**
 * An account with no local invoice rows gets its Stripe history fetched once
 * (then the webhook keeps it current). Remembered per process for ten
 * minutes, so an account with no invoices at all doesn't hit Stripe on every
 * Billing page view. Without a Stripe key there is nothing to fetch.
 */
export async function ensureInvoicesBackfilled(userId: number, now = Date.now()): Promise<{ backfilled: boolean; invoices: number }> {
  const checkedAt = backfillChecked.get(userId);
  if (checkedAt !== undefined && now - checkedAt < BACKFILL_MEMO_MS) return { backfilled: false, invoices: 0 };
  if ((await countLocalInvoices(userId)) > 0) {
    backfillChecked.set(userId, now);
    return { backfilled: false, invoices: 0 };
  }
  if (!stripeConfigured()) return { backfilled: false, invoices: 0 };
  const rows = await listInvoicesFromStripe(userId);
  backfillChecked.set(userId, now);
  return { backfilled: true, invoices: rows.length };
}

/** Tests only. */
export function resetBackfillMemo(): void {
  backfillChecked.clear();
}

// ---------------------------------------------------------------------------
// One-time purchases (mode "payment" Checkout Sessions: courses, DFY services, SEO contracts)

type CartItemMeta = { id?: string; type?: string; name?: string; price?: number; moduleId?: number | null };

function cartItems(session: Stripe.Checkout.Session): CartItemMeta[] {
  try {
    const items = JSON.parse(session.metadata?.items || "[]");
    return Array.isArray(items) ? items.filter((i) => i && typeof i === "object") : [];
  } catch {
    return [];
  }
}

/** course | service | reinstatement | other, from what our checkout wrote into the session's metadata. */
export function purchaseKindFor(session: Stripe.Checkout.Session): PurchaseKind {
  const type = session.metadata?.type;
  if (type === "master_class") return "course";
  if (type === "seo_contract") return "service";
  if (type === "reinstatement") return "reinstatement";
  if (type === "cart") {
    const types = new Set(cartItems(session).map((i) => String(i.type ?? "")));
    if (types.size && [...types].every((t) => t.startsWith("course_"))) return "course";
    if (types.size && [...types].every((t) => t.startsWith("dfy_"))) return "service";
  }
  return "other";
}

/** A description from our own checkout metadata (server-resolved names), when Stripe's line items can't be read. */
export async function purchaseDescriptionFromMetadata(session: Stripe.Checkout.Session): Promise<string | null> {
  const meta = session.metadata ?? {};
  if (meta.type === "cart") {
    const names = cartItems(session).map((i) => (typeof i.name === "string" ? i.name.trim() : "")).filter(Boolean);
    return names.length ? names.join(", ") : null;
  }
  if (meta.type === "master_class") {
    if (meta.bundle === "true") return "Master Class — complete bundle";
    const moduleId = positiveInt(meta.moduleId);
    if (moduleId) {
      try {
        const [mod] = await db.select().from(masterClassModules).where(eq(masterClassModules.id, moduleId)).limit(1);
        if (mod?.title) return `Master Class — ${mod.title}`;
      } catch { /* fall through to the generic label */ }
    }
    return "Master Class module";
  }
  if (meta.type === "seo_contract") {
    return meta.packageId ? `SEO package ${meta.packageId}${meta.contractId ? ` — contract #${meta.contractId}` : ""}` : "SEO package";
  }
  return null;
}

/** The product names Stripe charged for (the session's line items), else our metadata, else a plain label. */
export async function purchaseDescription(session: Stripe.Checkout.Session): Promise<string> {
  try {
    const expanded = (session as any).line_items?.data as Stripe.LineItem[] | undefined;
    const items = expanded ?? (await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 })).data;
    const names = items.map((li) => (li.description || "").trim()).filter(Boolean);
    if (names.length) return names.join(", ").slice(0, 1000);
  } catch (e: any) {
    console.warn(`[billing] line items for ${session.id} unavailable:`, e?.message || e);
  }
  return (await purchaseDescriptionFromMetadata(session)) ?? "One-time purchase";
}

/** The card receipt Stripe issued for the session's charge, when it can be read; never guessed. */
export async function receiptUrlForSession(session: Stripe.Checkout.Session): Promise<string | null> {
  const pi = session.payment_intent;
  if (!pi) return null;
  try {
    const expanded = typeof pi === "object" ? pi : null;
    const charge = expanded && typeof expanded.latest_charge === "object" ? expanded.latest_charge : null;
    if (charge?.receipt_url) return charge.receipt_url;
    const intent = await stripe.paymentIntents.retrieve(idOf(pi)!, { expand: ["latest_charge"] });
    const latest = intent.latest_charge;
    return latest && typeof latest === "object" ? latest.receipt_url ?? null : null;
  } catch (e: any) {
    console.warn(`[billing] receipt for ${session.id} unavailable:`, e?.message || e);
    return null;
  }
}

export const PAID_STATUSES: ReadonlySet<string> = new Set(["paid", "no_payment_required"]);

/**
 * The ledger row for a paid one-time checkout, or null when the session is
 * not one (a subscription checkout, or a payment still pending — ACH settles
 * later and arrives as checkout.session.async_payment_succeeded).
 */
export async function purchaseRowFromSession(session: Stripe.Checkout.Session, userId: number): Promise<BillingPurchaseRow | null> {
  if (session.mode !== "payment") return null;
  if (!PAID_STATUSES.has(session.payment_status)) return null;
  const amount = session.amount_total ?? cartItems(session).reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  return {
    id: idOf(session.payment_intent) ?? session.id,
    userId,
    kind: purchaseKindFor(session),
    description: await purchaseDescription(session),
    amount,
    currency: session.currency ?? "usd",
    created: epochToDate(session.created) ?? new Date(),
    receiptUrl: await receiptUrlForSession(session),
  };
}

const PURCHASE_BACKFILL_MAX_PAGES = 5;

/**
 * Every paid one-time checkout of the account's own customer, upserted into
 * billing_purchases and returned newest first. Sessions our checkout started
 * for a different account id (never expected) are skipped.
 */
export async function listPurchasesFromStripe(userId: number): Promise<BillingPurchaseRow[]> {
  const customerId = await customerIdForUser(userId);
  if (!customerId) return [];
  const rows: BillingPurchaseRow[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < PURCHASE_BACKFILL_MAX_PAGES; page++) {
    const res = await stripe.checkout.sessions.list({
      customer: customerId, status: "complete", limit: BACKFILL_PAGE,
      expand: ["data.payment_intent.latest_charge", "data.line_items"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const session of res.data) {
      const owner = positiveInt(session.metadata?.userId);
      if (owner && owner !== userId) continue;
      const row = await purchaseRowFromSession(session, userId);
      if (!row) continue;
      await upsertPurchase(row);
      rows.push(row);
    }
    if (!res.has_more || !res.data.length) break;
    startingAfter = res.data[res.data.length - 1].id;
  }
  return rows;
}
