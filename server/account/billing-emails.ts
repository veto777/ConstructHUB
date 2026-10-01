/**
 * Transactional account + billing emails.
 *
 *   sendWelcomeEmail(userId, baseUrl)         — after sign-up verification / Google sign-up (server/auth.ts)
 *   handleBillingEmailEvent(event)            — one branded email per billing event (below), deduped
 *   onStripeBillingEvent(stripeEvent, ctx)    — maps a VERIFIED Stripe event to those billing events and
 *                                               handles each; the one call the Stripe webhook makes
 *
 * Billing events (BILLING_EMAIL_EVENTS) and what each emails:
 *   billing.subscription_started      → plan, interval, add-ons/locations, trial end, next charge
 *   billing.subscription_changed      → what changed (plan / interval / add-ons / locations), prorated amount
 *   billing.cancellation_scheduled    → ends-on date, resume link
 *   billing.cancellation_reverted     → plan continues
 *   billing.subscription_ended        → no plan now, choose a plan
 *   billing.invoice_paid              → receipt: number, date, line items, totals, card, hosted + PDF links
 *   billing.invoice_payment_failed    → amount, retry date, update-card button (Settings → Manage billing → Stripe portal)
 *   billing.purchase_completed        → one-time receipt: course / service / reinstatement items, Stripe receipt link
 *
 * Every send goes through sendTransactionalEmail(userId, kind, dedupeKey, msg):
 * the dedupe key is claimed in email_log BEFORE sending (unique index), so a
 * redelivered webhook, a retried job or two lanes handling the same event
 * produce exactly one email; a failed send releases the claim so it can be
 * retried. Nothing here reads a secret into a message: templates get facts
 * (names, amounts, dates, public Stripe links) and nothing else.
 *
 * Contract note: sendTransactionalEmail here is the contract-identical
 * fallback for lane 1's helper (same signature, same email_log table). When
 * lane 1's server/account helper is present, import it instead — the rest of
 * this file does not change.
 */
import type Stripe from "stripe";
import { pool } from "../db";
import { sendWithFallback } from "../email";
import { PRIMARY_DOMAIN, siteBaseUrl } from "../site-context";
import {
  PLANS, ADDONS, ADDON_KEYS, planPriceCents, addonPriceCents, type AddonKey, type BillingInterval,
} from "@shared/plans";
import { describeSubscription, roleOfPrice, agencyLocationTiers, tieredAmountCents } from "../billing/prices";
import { subscriptionPeriodEnd, cancellationOf } from "../billing/sync";
import { COURSE_BUNDLE } from "../catalog";
import {
  welcomeEmail, subscriptionStartedEmail, receiptEmail, paymentFailedEmail, planChangedEmail,
  cancellationScheduledEmail, cancellationRevertedEmail, subscriptionEndedEmail, purchaseReceiptEmail,
  dateWords, intervalWord, money, safeUrl,
  type EmailMessage, type SubscriptionFacts, type InvoiceFacts, type ReceiptLine, type PurchaseFacts, type PurchaseKind, type PlanChangeFacts,
} from "./billing-email-templates";

export type { EmailMessage, SubscriptionFacts, InvoiceFacts, PurchaseFacts, PurchaseKind, PlanChangeFacts };

// ── Event contract ──────────────────────────────────────────────────────────

export const BILLING_EMAIL_EVENTS = [
  "billing.subscription_started",
  "billing.subscription_changed",
  "billing.cancellation_scheduled",
  "billing.cancellation_reverted",
  "billing.subscription_ended",
  "billing.invoice_paid",
  "billing.invoice_payment_failed",
  "billing.purchase_completed",
] as const;
export type BillingEmailEventType = (typeof BILLING_EMAIL_EVENTS)[number];

export type CardSummary = { brand: string; last4: string };
export type PurchaseItem = { label: string; detail?: string | null; amountCents: number; quantity?: number | null };

type Base = {
  userId: number;
  /** The Stripe event id when the event came from a webhook: the strongest dedupe key for "changed" events. */
  eventId?: string | null;
};
export type BillingEmailEvent =
  | (Base & { type: "billing.subscription_started"; subscription: Stripe.Subscription })
  | (Base & {
      type: "billing.subscription_changed";
      subscription: Stripe.Subscription;
      /** The items before the change (Stripe's previous_attributes.items.data). */
      previousItems?: Stripe.SubscriptionItem[] | null;
      /** Prorated amount charged now (positive) or credited (negative), cents. */
      prorationCents?: number | null;
      /** The proration invoice, when known (links in the email). */
      invoice?: Stripe.Invoice | null;
    })
  | (Base & { type: "billing.cancellation_scheduled"; subscription: Stripe.Subscription })
  | (Base & { type: "billing.cancellation_reverted"; subscription: Stripe.Subscription })
  | (Base & { type: "billing.subscription_ended"; subscription: Stripe.Subscription })
  | (Base & { type: "billing.invoice_paid"; invoice: Stripe.Invoice; card?: CardSummary | null })
  | (Base & { type: "billing.invoice_payment_failed"; invoice: Stripe.Invoice; card?: CardSummary | null })
  | (Base & {
      type: "billing.purchase_completed";
      session: Stripe.Checkout.Session;
      items: PurchaseItem[];
      kind: PurchaseKind;
      receiptUrl?: string | null;
      card?: CardSummary | null;
    });

/** email_log.kind for each email this module sends. */
export const EMAIL_KINDS = {
  welcome: "welcome",
  subscriptionStarted: "billing.subscription_started",
  subscriptionChanged: "billing.subscription_changed",
  cancellationScheduled: "billing.cancellation_scheduled",
  cancellationReverted: "billing.cancellation_reverted",
  subscriptionEnded: "billing.subscription_ended",
  receipt: "billing.receipt",
  paymentFailed: "billing.payment_failed",
  purchaseReceipt: "billing.purchase_receipt",
} as const;
export type EmailKind = (typeof EMAIL_KINDS)[keyof typeof EMAIL_KINDS];

export type SendOutcome = { kind: EmailKind; dedupeKey: string; sent: boolean; skipped?: string };

/** Public origin for links in emails sent without a request (webhooks, jobs). */
export function accountBaseUrl(): string {
  const env = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  return env || `https://${PRIMARY_DOMAIN}`;
}

/**
 * Origin for the links in an email sent from a request (the welcome email).
 * Pricing, the dashboard, Settings and the data tools live on the app origin
 * (APP_URL / the primary domain); the CRM portal host serves the CRM routes
 * only, and in production siteBaseUrl() deliberately prefers PORTAL_URL for
 * its CRM callers — so it is used here only outside production, where it
 * points at the dev server the request came from.
 */
export function appBaseUrl(req: unknown): string {
  if (process.env.NODE_ENV !== "production" && !process.env.REPLIT_DEPLOYMENT) return siteBaseUrl(req);
  return accountBaseUrl();
}

// ── sendTransactionalEmail (contract-identical fallback for lane 1's helper) ─

let emailLogReady: Promise<void> | null = null;
/**
 * email_log exactly as lane 1's ensureAccountSchema() defines it (same
 * columns, NOT NULL DEFAULT now() on sent_at, same index), so whichever DDL
 * runs first on a fresh database leaves a table the other's INSERT fits.
 */
export function ensureEmailLogSchema(): Promise<void> {
  emailLogReady ??= pool.query(`CREATE TABLE IF NOT EXISTS email_log (
      id bigserial PRIMARY KEY,
      user_id integer,
      kind text,
      dedupe_key text UNIQUE,
      sent_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS email_log_user_idx ON email_log(user_id, sent_at DESC)`).then(() => undefined, (err: any) => { emailLogReady = null; throw err; });
  return emailLogReady;
}

/**
 * Send one email to the account's address, once per dedupe key. Returns false
 * when the key was already claimed (nothing sent) or the user has no address.
 * The claim is taken before the send and released if the send throws.
 */
export async function sendTransactionalEmail(
  userId: number, kind: string, dedupeKey: string, msg: { subject: string; html: string; text: string },
): Promise<boolean> {
  await ensureEmailLogSchema();
  const { rows: [user] } = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
  if (!user?.email) {
    console.warn(`[email] ${kind} for user ${userId} not sent: no address on file`);
    return false;
  }
  const { rows: [claim] } = await pool.query(
    `INSERT INTO email_log (user_id, kind, dedupe_key, sent_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [userId, kind, dedupeKey]);
  if (!claim) return false;
  try {
    await sendWithFallback({
      from: `"ConstructHUB" <${process.env.SMTP_EMAIL}>`,
      to: user.email,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: { "X-Priority": "3", "Importance": "Normal", "X-ConstructHUB-Email": kind },
    });
  } catch (err) {
    await pool.query("DELETE FROM email_log WHERE id = $1", [claim.id]).catch(() => undefined);
    throw err;
  }
  return true;
}

// ── Welcome ─────────────────────────────────────────────────────────────────

/** First-steps email once the account is usable (verified sign-up, or a new Google account). One per user, ever. */
export async function sendWelcomeEmail(userId: number, baseUrl: string): Promise<boolean> {
  const { rows: [user] } = await pool.query("SELECT email, display_name FROM users WHERE id = $1", [userId]);
  if (!user?.email) return false;
  const msg = welcomeEmail({ displayName: user.display_name ?? null, email: user.email, baseUrl });
  return sendTransactionalEmail(userId, EMAIL_KINDS.welcome, `welcome:${userId}`, msg);
}

// ── Facts from Stripe objects (nothing the client sent is read) ─────────────

const epochDate = (epoch: unknown): Date | null =>
  typeof epoch === "number" && Number.isFinite(epoch) ? new Date(epoch * 1000) : null;

/** The Price object on an invoice line: `price` (pre-basil payloads) or `pricing.price_details.price` when expanded. */
function linePrice(line: any): Stripe.Price | null {
  if (line?.price && typeof line.price === "object") return line.price as Stripe.Price;
  const nested = line?.pricing?.price_details?.price;
  return nested && typeof nested === "object" ? (nested as Stripe.Price) : null;
}

const lineProrated = (line: any): boolean =>
  line?.proration === true || line?.parent?.subscription_item_details?.proration === true;

function labelForRole(price: Stripe.Price | null, fallback: string | null): string {
  const role = roleOfPrice(price);
  switch (role?.kind) {
    case "plan": return `ConstructHUB ${PLANS[role.key].name} plan (${intervalWord(role.interval)})`;
    case "addon": return `${ADDONS[role.key].name} (${intervalWord(role.interval)})`;
    case "agency_locations": return `Agency locations above ${PLANS.agency.limits.locations} (${intervalWord(role.interval)})`;
    case "setup": return `${ADDONS[role.key].name} setup (one time)`;
    default: return fallback?.trim() || price?.nickname || "Item";
  }
}

/** Plan name, price per interval, extras, trial and next-charge dates for a subscription. */
export function subscriptionFacts(sub: Stripe.Subscription): SubscriptionFacts {
  const items = sub.items?.data ?? [];
  const shape = describeSubscription(items);
  const currency = items[0]?.price?.currency ?? "usd";
  const interval: BillingInterval | null = shape.interval;
  const extras: string[] = [];
  let planName: string;
  let recurringCents: number | null;

  if (shape.plan && interval) {
    planName = PLANS[shape.plan].name;
    recurringCents = planPriceCents(shape.plan, interval);
    for (const key of ADDON_KEYS) {
      const qty = shape.addons[key] ?? 0;
      if (qty > 0) {
        recurringCents += addonPriceCents(key, interval) * qty;
        extras.push(`${ADDONS[key].name} × ${qty}`);
      }
    }
    if (shape.plan === "agency") {
      const included = PLANS.agency.limits.locations;
      recurringCents += tieredAmountCents(agencyLocationTiers(interval), shape.agencyExtraLocations);
      extras.push(`${included + shape.agencyExtraLocations} locations (${included} included${shape.agencyExtraLocations ? ` + ${shape.agencyExtraLocations} extra` : ""})`);
    }
  } else {
    // A legacy or sales-made subscription: name it from the price, total the unit amounts when Stripe gives them.
    const first = items[0]?.price;
    planName = first?.nickname || (typeof first?.product === "object" && (first.product as any)?.name) || "your plan";
    const priced = items.every((item) => typeof item.price?.unit_amount === "number");
    recurringCents = priced ? items.reduce((sum, item) => sum + (item.price!.unit_amount as number) * (item.quantity ?? 1), 0) : null;
    for (const item of items.slice(1)) {
      if (item.price?.nickname) extras.push(`${item.price.nickname}${(item.quantity ?? 1) > 1 ? ` × ${item.quantity}` : ""}`);
    }
  }

  return {
    planName,
    interval,
    recurringCents,
    currency,
    extras,
    trialEnd: epochDate(sub.trial_end),
    nextChargeAt: subscriptionPeriodEnd(sub),
    cancelAt: cancellationOf(sub).cancelAt,
    status: sub.status,
  };
}

/** Receipt facts for an invoice: labelled line items (plan / add-ons / Agency locations / setup fees), totals, links. */
export function invoiceFacts(invoice: Stripe.Invoice, card: CardSummary | null = null): InvoiceFacts {
  const anyInv = invoice as any;
  const lines: ReceiptLine[] = (invoice.lines?.data ?? []).map((line: any) => {
    const price = linePrice(line);
    const period = line.period && line.period.start !== line.period.end
      ? `${dateWords(line.period.start)} – ${dateWords(line.period.end)}`
      : null;
    return {
      label: labelForRole(price, line.description ?? null),
      detail: period,
      amountCents: Number(line.amount) || 0,
      quantity: typeof line.quantity === "number" ? line.quantity : null,
      prorated: lineProrated(line),
    };
  });
  const taxCents = typeof anyInv.tax === "number"
    ? anyInv.tax
    : (invoice.total_taxes ?? []).reduce((sum, tax: any) => sum + (Number(tax?.amount) || 0), 0);
  const discountCents = (invoice.total_discount_amounts ?? []).reduce((sum, d: any) => sum + (Number(d?.amount) || 0), 0);
  const totalCents = Number(invoice.total) || 0;
  const amountDueCents = Number(invoice.amount_due) || 0;
  return {
    id: invoice.id,
    number: invoice.number ?? null,
    currency: invoice.currency ?? "usd",
    paidAt: epochDate(invoice.status_transitions?.paid_at),
    createdAt: epochDate(invoice.created),
    periodStart: epochDate(invoice.period_start),
    periodEnd: epochDate(invoice.period_end),
    lines,
    subtotalCents: Number(invoice.subtotal) || 0,
    taxCents,
    discountCents,
    totalCents,
    amountPaidCents: Number(invoice.amount_paid) || 0,
    amountDueCents,
    // Stripe charges amount_due, which is the total after the customer's
    // balance: a credit applied (negative) or a previous balance owed (positive).
    // Without this row the receipt's numbers would not add up to "Total paid".
    balanceCents: amountDueCents - totalCents,
    card,
    hostedInvoiceUrl: safeUrl(invoice.hosted_invoice_url),
    invoicePdf: safeUrl(invoice.invoice_pdf),
    nextPaymentAttempt: epochDate(invoice.next_payment_attempt),
    attemptCount: Number(invoice.attempt_count) || 0,
    billingReason: invoice.billing_reason ?? null,
    description: invoice.description ?? null,
  };
}

/** "Plan: Pro → Growth", "Extra seat: 1 → 3", … between two item sets. */
export function describeChanges(before: Stripe.SubscriptionItem[] | null | undefined, after: Stripe.SubscriptionItem[]): string[] {
  const next = describeSubscription(after);
  if (!before) {
    const facts = subscriptionFacts({ items: { data: after } } as any);
    return [`Subscription updated: ${facts.planName}${next.interval ? `, billed ${intervalWord(next.interval)}` : ""}`, ...facts.extras.map((e) => `Includes ${e}`)];
  }
  const prev = describeSubscription(before);
  const changes: string[] = [];
  const name = (key: typeof prev.plan) => (key ? PLANS[key].name : "a previous plan");
  if (prev.plan !== next.plan) changes.push(`Plan: ${name(prev.plan)} → ${name(next.plan)}`);
  if (prev.interval !== next.interval && next.interval) changes.push(`Billing: ${intervalWord(prev.interval) || "—"} → ${intervalWord(next.interval)}`);
  for (const key of ADDON_KEYS as readonly AddonKey[]) {
    const was = prev.addons[key] ?? 0, now = next.addons[key] ?? 0;
    if (was === now) continue;
    if (!was) changes.push(`${ADDONS[key].name}: added${now > 1 ? ` × ${now}` : ""}`);
    else if (!now) changes.push(`${ADDONS[key].name}: removed`);
    else changes.push(`${ADDONS[key].name}: ${was} → ${now}`);
  }
  const included = PLANS.agency.limits.locations;
  if ((prev.plan === "agency" || next.plan === "agency") && prev.agencyExtraLocations !== next.agencyExtraLocations) {
    changes.push(`Locations: ${prev.plan === "agency" ? included + prev.agencyExtraLocations : "—"} → ${next.plan === "agency" ? included + next.agencyExtraLocations : "—"}`);
  }
  if (!changes.length) {
    // Same roles, different Stripe prices (a repriced legacy item): say so without inventing numbers.
    const changedIds = after.filter((a) => !before.some((b) => b.price?.id === a.price?.id && (b.quantity ?? 1) === (a.quantity ?? 1)));
    for (const item of changedIds) changes.push(`${labelForRole(item.price, item.price?.nickname ?? null)}${(item.quantity ?? 1) > 1 ? ` × ${item.quantity}` : ""}`);
  }
  return changes.length ? changes : ["Subscription items updated"];
}

const itemsFingerprint = (items: Stripe.SubscriptionItem[]) =>
  items.map((i) => `${i.price?.id ?? "?"}x${i.quantity ?? 1}`).sort().join(",");

const isFullItem = (entry: any): boolean =>
  !!entry && typeof entry === "object" && typeof entry.id === "string" && !!entry.price && typeof entry.price === "object";

/**
 * The subscription's items before a `customer.subscription.updated` event.
 *
 * Stripe's `previous_attributes.items.data` is a diff, not a snapshot: an item
 * changed in place appears as a PARTIAL object at its index holding only the
 * fields that changed (`price`/`plan` on a plan swap, `quantity` on a quantity
 * change — and, on current API versions, `current_period_start/end` on every
 * renewal), while an added or removed item yields the full previous list.
 * Comparing a partial entry as if it were an item would invent changes ("a
 * previous plan → Pro", a seat add-on "added") and email one every month, so
 * the previous items are rebuilt over the current ones. Null when they cannot
 * be rebuilt.
 */
export function previousItemsFrom(previous: Record<string, any> | null | undefined, after: Stripe.SubscriptionItem[]): Stripe.SubscriptionItem[] | null {
  const data = previous?.items?.data;
  if (!Array.isArray(data)) return null;
  if (data.every(isFullItem)) return data as Stripe.SubscriptionItem[];
  if (data.length !== after.length) return null;
  return after.map((item, i) => {
    const prev = data[i];
    return prev && typeof prev === "object" ? ({ ...item, ...prev } as Stripe.SubscriptionItem) : item;
  });
}

// ── Handler ─────────────────────────────────────────────────────────────────

/** Build the message and dedupe key for an event (exported for tests; no side effects). */
export function billingEmailFor(event: BillingEmailEvent, baseUrl = accountBaseUrl()): { kind: EmailKind; dedupeKey: string; message: EmailMessage | null; skipped?: string } {
  switch (event.type) {
    case "billing.subscription_started": {
      const sub = event.subscription;
      return { kind: EMAIL_KINDS.subscriptionStarted, dedupeKey: `subscription_started:${sub.id}`, message: subscriptionStartedEmail(subscriptionFacts(sub), baseUrl) };
    }
    case "billing.subscription_changed": {
      const sub = event.subscription;
      const after = sub.items?.data ?? [];
      const before = event.previousItems ?? null;
      const facts: PlanChangeFacts = {
        before: before ? subscriptionFacts({ ...sub, items: { ...sub.items, data: before } } as Stripe.Subscription) : null,
        after: subscriptionFacts(sub),
        changes: describeChanges(before, after),
        prorationCents: typeof event.prorationCents === "number" ? event.prorationCents : null,
        invoice: event.invoice ? { number: event.invoice.number ?? null, hostedInvoiceUrl: safeUrl(event.invoice.hosted_invoice_url), invoicePdf: safeUrl(event.invoice.invoice_pdf) } : null,
      };
      const dedupeKey = `subscription_changed:${event.eventId || `${sub.id}:${itemsFingerprint(after)}`}`;
      return { kind: EMAIL_KINDS.subscriptionChanged, dedupeKey, message: planChangedEmail(facts, baseUrl) };
    }
    case "billing.cancellation_scheduled": {
      const sub = event.subscription;
      const facts = subscriptionFacts(sub);
      const at = facts.cancelAt ? Math.floor(facts.cancelAt.getTime() / 1000) : "period_end";
      return { kind: EMAIL_KINDS.cancellationScheduled, dedupeKey: `cancellation_scheduled:${sub.id}:${at}`, message: cancellationScheduledEmail(facts, baseUrl) };
    }
    case "billing.cancellation_reverted": {
      const sub = event.subscription;
      const facts = subscriptionFacts(sub);
      const dedupeKey = `cancellation_reverted:${event.eventId || `${sub.id}:${facts.nextChargeAt ? Math.floor(facts.nextChargeAt.getTime() / 1000) : "now"}`}`;
      return { kind: EMAIL_KINDS.cancellationReverted, dedupeKey, message: cancellationRevertedEmail(facts, baseUrl) };
    }
    case "billing.subscription_ended": {
      const sub = event.subscription;
      const facts = subscriptionFacts(sub);
      if (!facts.cancelAt) facts.cancelAt = epochDate((sub as any).ended_at ?? (sub as any).canceled_at) ?? null;
      return { kind: EMAIL_KINDS.subscriptionEnded, dedupeKey: `subscription_ended:${sub.id}`, message: subscriptionEndedEmail(facts, baseUrl) };
    }
    case "billing.invoice_paid": {
      const facts = invoiceFacts(event.invoice, event.card ?? null);
      const dedupeKey = `receipt:${event.invoice.id}`;
      // A $0 invoice (trial start, a 100% credit) is not a payment: the
      // subscription-started email already names the trial end and first charge.
      if (facts.amountPaidCents <= 0) return { kind: EMAIL_KINDS.receipt, dedupeKey, message: null, skipped: "zero_amount" };
      return { kind: EMAIL_KINDS.receipt, dedupeKey, message: receiptEmail(facts, baseUrl) };
    }
    case "billing.invoice_payment_failed": {
      const facts = invoiceFacts(event.invoice, event.card ?? null);
      return { kind: EMAIL_KINDS.paymentFailed, dedupeKey: `payment_failed:${event.invoice.id}:${facts.attemptCount || 1}`, message: paymentFailedEmail(facts, baseUrl) };
    }
    case "billing.purchase_completed": {
      const session = event.session as any;
      const facts: PurchaseFacts = {
        id: session.id,
        kind: event.kind,
        currency: session.currency ?? "usd",
        paidAt: epochDate(session.created) ?? new Date(),
        items: event.items,
        totalCents: typeof session.amount_total === "number" ? session.amount_total : event.items.reduce((sum, i) => sum + i.amountCents * (i.quantity ?? 1), 0),
        card: event.card ?? null,
        receiptUrl: safeUrl(event.receiptUrl),
      };
      return { kind: EMAIL_KINDS.purchaseReceipt, dedupeKey: `purchase_receipt:${session.id}`, message: purchaseReceiptEmail(facts, baseUrl) };
    }
  }
}

/** Send the email for one billing event (deduped). Throws on a send failure so the caller can log/retry. */
export async function handleBillingEmailEvent(event: BillingEmailEvent, opts: { baseUrl?: string } = {}): Promise<SendOutcome> {
  if (!Number.isInteger(event.userId) || event.userId <= 0) throw new Error(`[billing-emails] ${event.type} needs a userId`);
  const { kind, dedupeKey, message, skipped } = billingEmailFor(event, opts.baseUrl ?? accountBaseUrl());
  if (!message) return { kind, dedupeKey, sent: false, skipped };
  const sent = await sendTransactionalEmail(event.userId, kind, dedupeKey, message);
  return { kind, dedupeKey, sent };
}

// ── Stripe adapter ──────────────────────────────────────────────────────────

/** The few Stripe reads the adapter may make (card brand/last4, receipt and proration-invoice links). A real `Stripe` client satisfies it. */
export type StripeReader = {
  charges: { retrieve: (id: string, params?: any) => Promise<any> };
  paymentIntents: { retrieve: (id: string, params?: any) => Promise<any> };
  paymentMethods: { retrieve: (id: string, params?: any) => Promise<any> };
  invoices: { retrieve: (id: string, params?: any) => Promise<any> };
};

function cardOf(source: any): CardSummary | null {
  const card = source?.payment_method_details?.card ?? source?.card;
  if (card?.last4) return { brand: String(card.brand || "card"), last4: String(card.last4) };
  const bank = source?.payment_method_details?.us_bank_account ?? source?.us_bank_account;
  if (bank?.last4) return { brand: `${bank.bank_name || "Bank account"}`, last4: String(bank.last4) };
  return null;
}

/** Card brand + last4 behind an invoice's payment, via one Stripe read; null when unknown or Stripe is unavailable. */
export async function cardSummaryForInvoice(invoice: Stripe.Invoice, stripe: StripeReader | null | undefined): Promise<CardSummary | null> {
  if (!stripe) return null;
  const anyInv = invoice as any;
  const payment = anyInv.payments?.data?.[0]?.payment;
  const chargeId = typeof anyInv.charge === "string" ? anyInv.charge : typeof payment?.charge === "string" ? payment.charge : null;
  const intentId = typeof anyInv.payment_intent === "string" ? anyInv.payment_intent : typeof payment?.payment_intent === "string" ? payment.payment_intent : null;
  const methodId = typeof invoice.default_payment_method === "string" ? invoice.default_payment_method : null;
  try {
    if (chargeId) return cardOf(await stripe.charges.retrieve(chargeId));
    if (intentId) {
      const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] });
      return cardOf(intent?.latest_charge) ?? cardOf(intent?.payment_method);
    }
    if (methodId) return cardOf(await stripe.paymentMethods.retrieve(methodId));
  } catch (err: any) {
    console.warn(`[billing-emails] card lookup for ${invoice.id} failed: ${err?.message || err}`);
  }
  return null;
}

/** The Stripe receipt link + card for a paid Checkout Session (one PaymentIntent read). */
export async function receiptForSession(session: Stripe.Checkout.Session, stripe: StripeReader | null | undefined): Promise<{ receiptUrl: string | null; card: CardSummary | null }> {
  const intentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent as any)?.id;
  if (!stripe || !intentId) return { receiptUrl: null, card: null };
  try {
    const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] });
    const charge = intent?.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    return { receiptUrl: safeUrl(charge?.receipt_url), card: cardOf(charge) };
  } catch (err: any) {
    console.warn(`[billing-emails] receipt lookup for ${session.id} failed: ${err?.message || err}`);
    return { receiptUrl: null, card: null };
  }
}

/** What a one-time Checkout Session sold, from the metadata OUR checkout wrote (server-resolved names and prices). */
export async function purchaseItemsForSession(session: Stripe.Checkout.Session): Promise<{ items: PurchaseItem[]; kind: PurchaseKind }> {
  const meta = session.metadata ?? {};
  const total = typeof session.amount_total === "number" ? session.amount_total : 0;
  if (meta.type === "cart") {
    let raw: any[] = [];
    try { raw = JSON.parse(meta.items || "[]"); } catch { raw = []; }
    const items: PurchaseItem[] = raw.map((item) => ({ label: String(item?.name || "Item"), amountCents: Number(item?.price) || 0, quantity: 1 }));
    const types = new Set(raw.map((item) => String(item?.type || "")));
    const kind: PurchaseKind = [...types].every((t) => t.startsWith("course")) ? "course" : [...types].every((t) => t.startsWith("dfy")) ? "service" : "other";
    return { items: items.length ? items : [{ label: "Purchase", amountCents: total }], kind };
  }
  if (meta.type === "master_class") {
    if (meta.bundle === "true") return { items: [{ label: `Master Class — ${COURSE_BUNDLE.name.replace(/^Master Class — /, "")}`, amountCents: total || COURSE_BUNDLE.priceCents }], kind: "course" };
    const moduleId = Number(meta.moduleId);
    if (Number.isInteger(moduleId)) {
      const { rows: [mod] } = await pool.query("SELECT title, price FROM master_class_modules WHERE id = $1", [moduleId]);
      if (mod) return { items: [{ label: `Master Class — ${mod.title}`, amountCents: total || Number(mod.price) || 0 }], kind: "course" };
    }
    return { items: [{ label: "Master Class module", amountCents: total }], kind: "course" };
  }
  if (meta.type === "reinstatement") return { items: [{ label: meta.description || "Account reinstatement", amountCents: total }], kind: "reinstatement" };
  if (meta.type === "seo_contract") {
    // server/routes.ts SEO agreement checkout: one upfront charge for the whole term.
    const label = `SEO package agreement${meta.contractId ? ` — contract #${meta.contractId}` : ""}, paid in full`;
    return { items: [{ label, detail: meta.packageId ? `Package ${meta.packageId}` : null, amountCents: total }], kind: "service" };
  }
  const lines = (session as any).line_items?.data as any[] | undefined;
  if (lines?.length) {
    return { items: lines.map((l) => ({ label: String(l.description || "Item"), amountCents: Number(l.amount_total) || 0, quantity: l.quantity ?? 1 })), kind: "other" };
  }
  return { items: [{ label: "Purchase", amountCents: total }], kind: "other" };
}

/** The account a Stripe object belongs to: our checkout/subscription metadata first, then the customer id on the subscriptions row. */
export async function userIdForStripeObject(object: any): Promise<number | null> {
  const fromMeta = Number(object?.metadata?.userId ?? object?.parent?.subscription_details?.metadata?.userId ?? object?.subscription_details?.metadata?.userId);
  if (Number.isInteger(fromMeta) && fromMeta > 0) return fromMeta;
  const customerId = typeof object?.customer === "string" ? object.customer : object?.customer?.id;
  if (!customerId) return null;
  const { rows: [row] } = await pool.query("SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1", [customerId]);
  return row?.user_id ? Number(row.user_id) : null;
}

const PAID_SESSION_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

/**
 * Map one verified Stripe event to the billing events above. Pure on the
 * event's own data except for the optional Stripe reads (card, receipt link,
 * proration invoice) when `stripe` is given.
 */
export async function billingEmailEventsFromStripe(event: Stripe.Event, ctx: { userId: number; stripe?: StripeReader | null }): Promise<BillingEmailEvent[]> {
  const { userId, stripe } = ctx;
  const eventId = event.id ?? null;
  const object = event.data?.object as any;
  const previous = (event.data as any)?.previous_attributes as Record<string, any> | undefined;
  const out: BillingEmailEvent[] = [];

  switch (event.type) {
    case "customer.subscription.created":
      out.push({ type: "billing.subscription_started", userId, eventId, subscription: object });
      break;
    case "customer.subscription.updated": {
      const sub = object as Stripe.Subscription;
      if (previous && ("cancel_at_period_end" in previous || "cancel_at" in previous)) {
        const now = cancellationOf(sub);
        const wasCanceling = previous.cancel_at_period_end === true || (typeof previous.cancel_at === "number");
        const isCanceling = now.cancelAtPeriodEnd === true || !!now.cancelAt;
        if (isCanceling && !wasCanceling) out.push({ type: "billing.cancellation_scheduled", userId, eventId, subscription: sub });
        else if (!isCanceling && wasCanceling) out.push({ type: "billing.cancellation_reverted", userId, eventId, subscription: sub });
      }
      if (previous && "items" in previous) {
        const after = sub.items?.data ?? [];
        const previousItems = previousItemsFrom(previous, after);
        // Only a real change of prices or quantities is a plan/add-on change; a
        // renewal that touched the items' period fields is not (the receipt covers it).
        if (previousItems && itemsFingerprint(previousItems) === itemsFingerprint(after)) break;
        let prorationCents: number | null = null;
        let invoice: Stripe.Invoice | null = null;
        const latest = sub.latest_invoice;
        if (latest && typeof latest === "object") invoice = latest as Stripe.Invoice;
        else if (typeof latest === "string" && stripe) {
          try { invoice = await stripe.invoices.retrieve(latest); } catch (err: any) { console.warn(`[billing-emails] invoice ${latest} lookup failed: ${err?.message || err}`); }
        }
        if (invoice && invoice.billing_reason === "subscription_update") {
          prorationCents = typeof invoice.total === "number" ? invoice.total : null;
        } else {
          invoice = null;
        }
        out.push({ type: "billing.subscription_changed", userId, eventId, subscription: sub, previousItems, prorationCents, invoice });
      }
      break;
    }
    case "customer.subscription.deleted":
      out.push({ type: "billing.subscription_ended", userId, eventId, subscription: object });
      break;
    case "invoice.paid":
    case "invoice.payment_succeeded":
      out.push({ type: "billing.invoice_paid", userId, eventId, invoice: object, card: await cardSummaryForInvoice(object, stripe) });
      break;
    case "invoice.payment_failed":
      out.push({ type: "billing.invoice_payment_failed", userId, eventId, invoice: object, card: await cardSummaryForInvoice(object, stripe) });
      break;
    default:
      if (PAID_SESSION_EVENTS.has(event.type)) {
        const session = object as Stripe.Checkout.Session;
        if (session.mode === "payment" && session.payment_status === "paid") {
          const { items, kind } = await purchaseItemsForSession(session);
          const { receiptUrl, card } = await receiptForSession(session, stripe);
          out.push({ type: "billing.purchase_completed", userId, eventId, session, items, kind, receiptUrl, card });
        }
      }
  }
  return out;
}

/**
 * The webhook's one call, after signature verification and its own
 * processing: resolve the account, map the event, send each email. Never
 * throws — an email problem must not fail the webhook (Stripe would redeliver
 * an event the app already applied); it is logged and reported in the result.
 */
export async function onStripeBillingEvent(
  event: Stripe.Event,
  ctx: { userId?: number | null; stripe?: StripeReader | null; baseUrl?: string } = {},
): Promise<SendOutcome[]> {
  const results: SendOutcome[] = [];
  try {
    const userId = ctx.userId ?? await userIdForStripeObject(event.data?.object);
    if (!userId) return results;
    const events = await billingEmailEventsFromStripe(event, { userId, stripe: ctx.stripe });
    for (const billingEvent of events) {
      try {
        results.push(await handleBillingEmailEvent(billingEvent, { baseUrl: ctx.baseUrl }));
      } catch (err: any) {
        console.error(`[billing-emails] ${billingEvent.type} (${event.id}) email failed: ${err?.message || err}`);
      }
    }
  } catch (err: any) {
    console.error(`[billing-emails] ${event.type} (${event.id}) not handled: ${err?.message || err}`);
  }
  return results;
}

export { money, dateWords };
