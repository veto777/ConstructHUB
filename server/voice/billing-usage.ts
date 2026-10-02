/**
 * Call Assistant minutes: the voice_usage meter and overage billing
 * (docs/call-assistant/SPEC.md §2 voice_usage, §14). OWNER: numbers+billing lane.
 *
 * The meter follows server/growth-quotas.ts: one row per paying account per
 * month ("YYYY-MM", UTC), counted at the moment the work is known to have
 * happened — here, when the engine's end-of-call report lands on
 * PUT /api/voice-internal/calls/:callSid (calls+crm lane calls
 * `recordVoiceCallUsage` from there). A call is never refused for minutes:
 * the caller is already on the line, so minutes above the included allowance
 * are OVERAGE, billed per minute at the overage rate of the tier in force
 * when the call is recorded (shared/plans.ts CALL_ASSISTANT_TIERS
 * overageCentsPerMinute: Lite and Solo 10¢, Crew and Fleet 5¢) on the owner's
 * next Stripe invoice. Each call's overage minutes go into the bucket of its
 * rate (overage_rate_minutes, {"10": 30, "5": 120}), so a mid-month switch
 * between a 10¢ and a 5¢ tier bills every call at its own rate.
 *
 * Spam is free up to a point (owner, 2026-10-02: "all plans cover 500 spam
 * calls that aren't charged"): the minutes of a call classified spam
 * (outcome `spam`) are recorded as spam_free_minutes, NOT as minutes, for the
 * first CALL_ASSISTANT_FREE_SPAM_CALLS such calls of the org's calendar
 * month (UTC); above that they count like any call. A `blocked` call (a
 * number already blocked, rejected before answering) costs 0 minutes and
 * never uses the allowance. `minutes` is therefore the BILLABLE minutes: what
 * the included allowance and the overage are measured against.
 *
 * Overage reaches Stripe as an invoice item on the subscription's customer
 * (`stripe.invoiceItems.create` with `pricing.price` = a one-time Price found
 * by lookup key, the server/billing/prices.ts pattern). stripe-node 20 has no
 * usage records any more, and a Billing Meter would add a foreign
 * subscription item that server/billing/order.ts treats as "set up by sales";
 * an invoice item touches nothing on the subscription. A monthly subscription
 * picks it up on its next invoice; an ANNUAL one would hold it for up to a
 * year, so for those each rate's item is invoiced on its own right away.
 * Reporting is idempotent per month and rate: only each bucket's minutes above
 * its reported count (overage_reported_rate_minutes) are ever sent, one invoice
 * item per rate (Stripe idempotency key per rate and running total), and each
 * bucket is recorded as billed as soon as Stripe has it, so a failure on one
 * rate never re-sends another.
 */
import { pool } from "../db";
import { getEntitlements, callAssistantAllowance } from "../entitlements";
import { stripe as stripeClient, stripeConfigured } from "../billing/client";
import { hasLiveStripeSubscription } from "../billing/sync";
import { ACCESS_STATUSES, CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS, CALL_ASSISTANT_FREE_SPAM_CALLS, CALL_ASSISTANT_NAME } from "@shared/plans";
import type { VoiceUsageRow } from "@shared/schema";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/** "YYYY-MM" (UTC), like growth-quotas monthKey. */
export const voiceMonthKey = (d = new Date()) => d.toISOString().slice(0, 7);
/** First instant of next month (UTC). */
export const voiceResetsAt = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();

/** What a call costs in minutes: every started minute, like the carriers bill. 0 s → 0. */
export const billedMinutesFor = (durationSeconds: number | null | undefined) =>
  Math.max(0, Math.ceil(Math.max(0, Number(durationSeconds ?? 0)) / 60));

/** Outcomes that count a minute but never a lead; `blocked` is answered by <Reject/> and costs nothing. */
export const isSpamOutcome = (outcome: string | null | undefined) => outcome === "spam";
export const isBlockedOutcome = (outcome: string | null | undefined) => outcome === "blocked";

export type VoiceUsageSummary = {
  month: string;
  calls: number;
  /** Billable minutes (free spam minutes excluded). */
  minutes: number;
  /** Answered calls classified spam. */
  spamCalls: number;
  /** Calls from blocked numbers, rejected before answering (0 minutes). */
  blockedCalls: number;
  /** spamCalls + blockedCalls — "spam calls this month". */
  spamCallsThisMonth: number;
  /** Spam calls whose minutes were not counted (at most freeSpamCallsLimit). */
  freeSpamCalls: number;
  freeSpamMinutes: number;
  freeSpamCallsLimit: number;
  includedMinutes: number;
  remainingMinutes: number;
  overageMinutes: number;
  /** What the overage costs: each bucket's minutes at its own rate. */
  overageCents: number;
  /** The overage rate in force now (this month) or at the month's latest call (a past month). */
  overageCentsPerMinute: number;
  /** The overage per rate, highest rate first ({ centsPerMinute: 10, minutes: 30 }). */
  overageByRate: { centsPerMinute: number; minutes: number }[];
  overageReportedMinutes: number;
  overageReportedCents: number;
  resetsAt: string;
};

/** A rate-bucket map ({"10": 30}) as [rate, minutes] pairs with minutes, highest rate first. */
function buckets(map: Record<string, number> | null | undefined): [number, number][] {
  return Object.entries(map ?? {})
    .map(([rate, minutes]) => [Number(rate), Math.max(0, Number(minutes) || 0)] as [number, number])
    .filter(([rate, minutes]) => Number.isFinite(rate) && rate > 0 && minutes > 0)
    .sort((a, b) => b[0] - a[0]);
}
const centsOf = (pairs: [number, number][]) => pairs.reduce((sum, [rate, minutes]) => sum + rate * minutes, 0);

/**
 * The summary the Overview and Limits & usage show. `includedNow` is the live
 * allowance: it is what's included for the current month (or a month with no
 * row); a past month shows its own snapshot. Overage is the row's accrued
 * overage_minutes (per call, recordVoiceCallUsage), never recomputed from the
 * total, so it always matches what is billed; its cost is each rate bucket at
 * its own rate. `rateNow` is the live tier's overage rate (0 without one).
 */
export function summarizeVoiceUsage(row: Partial<VoiceUsageRow> | null | undefined, month: string, includedNow: number, rateNow = 0): VoiceUsageSummary {
  const minutes = Number(row?.minutes ?? 0);
  const snapshot = row?.includedMinutes ?? null;
  const included = snapshot !== null && (month !== voiceMonthKey() || includedNow === 0) ? Number(snapshot) : includedNow;
  const overage = row?.overageMinutes !== undefined && row?.overageMinutes !== null
    ? Math.max(0, Number(row.overageMinutes))
    : included < 0 ? 0 : Math.max(0, minutes - included);
  const snapshotRate = row?.overageCentsPerMinute ?? null;
  const rate = rateNow > 0 && (month === voiceMonthKey() || snapshotRate === null) ? rateNow : snapshotRate ?? CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS;
  // Overage with no bucket (a row from before per-tier rates, or a test row) is priced at the month's rate.
  let byRate = buckets(row?.overageRateMinutes);
  const bucketed = byRate.reduce((n, [, m]) => n + m, 0);
  if (overage > bucketed) byRate = [...byRate.filter(([r]) => r !== rate), [rate, (byRate.find(([r]) => r === rate)?.[1] ?? 0) + overage - bucketed] as [number, number]].sort((a, b) => b[0] - a[0]);
  const reported = Number(row?.overageReportedMinutes ?? 0);
  let reportedByRate = buckets(row?.overageReportedRateMinutes);
  const reportedBucketed = reportedByRate.reduce((n, [, m]) => n + m, 0);
  if (reported > reportedBucketed) reportedByRate = [...reportedByRate, [rate, reported - reportedBucketed] as [number, number]];
  return {
    month,
    calls: Number(row?.calls ?? 0),
    minutes,
    spamCalls: Number(row?.spamCalls ?? 0),
    blockedCalls: Number(row?.blockedCalls ?? 0),
    spamCallsThisMonth: Number(row?.spamCalls ?? 0) + Number(row?.blockedCalls ?? 0),
    freeSpamCalls: Number(row?.spamFreeCalls ?? 0),
    freeSpamMinutes: Number(row?.spamFreeMinutes ?? 0),
    freeSpamCallsLimit: CALL_ASSISTANT_FREE_SPAM_CALLS,
    includedMinutes: included,
    remainingMinutes: included < 0 ? included : Math.max(0, included - minutes),
    overageMinutes: overage,
    overageCents: centsOf(byRate),
    overageCentsPerMinute: rate,
    overageByRate: byRate.map(([centsPerMinute, m]) => ({ centsPerMinute, minutes: m })),
    overageReportedMinutes: reported,
    overageReportedCents: centsOf(reportedByRate),
    resetsAt: voiceResetsAt(new Date(`${month}-01T00:00:00Z`)),
  };
}

function rateMap(v: unknown): Record<string, number> {
  const obj = typeof v === "string" ? JSON.parse(v) : v;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries((obj ?? {}) as Record<string, unknown>)) out[k] = Number(n) || 0;
  return out;
}

function rowFrom(r: any): VoiceUsageRow {
  return {
    id: Number(r.id), orgId: r.org_id, accountUserId: Number(r.account_user_id), month: r.month,
    calls: Number(r.calls), minutes: Number(r.minutes), spamCalls: Number(r.spam_calls), blockedCalls: Number(r.blocked_calls),
    spamFreeCalls: Number(r.spam_free_calls ?? 0), spamFreeMinutes: Number(r.spam_free_minutes ?? 0),
    includedMinutes: r.included_minutes === null ? null : Number(r.included_minutes),
    overageMinutes: Number(r.overage_minutes), overageReportedMinutes: Number(r.overage_reported_minutes),
    overageRateMinutes: rateMap(r.overage_rate_minutes), overageReportedRateMinutes: rateMap(r.overage_reported_rate_minutes),
    overageCentsPerMinute: r.overage_cents_per_minute === null || r.overage_cents_per_minute === undefined ? null : Number(r.overage_cents_per_minute),
    overageReportedAt: r.overage_reported_at, stripeUsageRecordId: r.stripe_usage_record_id, updatedAt: r.updated_at,
  };
}

export type RecordUsageInput = {
  orgId: string;
  /** The paying account (crm_orgs.owner_user_id). */
  accountUserId: number;
  /** CALL_OUTCOMES; `blocked` counts a call and nothing else. */
  outcome: string | null | undefined;
  durationSeconds?: number | null;
  /** Already-rounded minutes win over durationSeconds when the engine reports both. */
  billedMinutes?: number | null;
  /** The month the call belongs to (its start); defaults to now. */
  at?: Date;
};

/**
 * Count one finished call on the account's month (atomic upsert).
 *
 * Overage ACCRUES PER CALL against the allowance in force when the call is
 * recorded: a call adds to overage_minutes only the part of its billable
 * minutes that lands above the current tier's included minutes. It is never
 * recomputed from the month's total, so minutes that were already over stay
 * overage after a later upgrade (a one-day Crew/Fleet upgrade, prorated by the
 * day, can't wipe the month's overage), and a downgrade lowers the allowance
 * for every call after it (the bigger tier's unused time is credited back).
 * The call's overage minutes are priced at the overage rate of the tier in
 * force when it is recorded: they go into that rate's bucket
 * (overage_rate_minutes), so Solo minutes stay 10¢ and Crew minutes 5¢ in a
 * month that switched between them.
 * `included_minutes` is the allowance in force at the month's latest call
 * (and `overage_cents_per_minute` its rate);
 * when the account has no allowance at that moment (a call that ends just
 * after a cancellation) the month's snapshot is kept. A negative allowance is
 * unlimited (-1, the price book's convention): no overage.
 *
 * A spam call with minutes is free while the month's
 * spam_free_calls is under `freeSpamCalls` (CALL_ASSISTANT_FREE_SPAM_CALLS):
 * the decision is made against the row as locked by the upsert, so two calls
 * finishing together never both take the 500th free slot. Returns the
 * month's row after the call.
 */
export async function recordVoiceCallUsage(input: RecordUsageInput, q: Queryable = pool, freeSpamCalls = CALL_ASSISTANT_FREE_SPAM_CALLS): Promise<VoiceUsageRow> {
  const month = voiceMonthKey(input.at ?? new Date());
  const blocked = isBlockedOutcome(input.outcome);
  const spam = isSpamOutcome(input.outcome);
  const minutes = blocked ? 0 : (input.billedMinutes ?? billedMinutesFor(input.durationSeconds));
  const allowance = callAssistantAllowance(await getEntitlements(input.accountUserId));
  const included = allowance.minutes;
  // $5 = spam (1/0), $8 = the free spam-call allowance. A spam call with no minutes uses none of it.
  const waiveNew = `($5::int = 1 AND $4::int > 0 AND $8::int > 0)`;
  const waive = `($5::int = 1 AND $4::int > 0 AND voice_usage.spam_free_calls < $8::int)`;
  // This call's billable minutes, and the allowance in force now ($7 = the live tier; none → keep the month's snapshot).
  const billable = `(CASE WHEN ${waive} THEN 0 ELSE $4::int END)`;
  const allow = `(CASE WHEN $7::int <> 0 THEN $7::int ELSE COALESCE(voice_usage.included_minutes, 0) END)`;
  // The overage rate in force now ($9 = the live tier's; none → the month's snapshot, then $10 the default).
  const rateNew = `(CASE WHEN $9::int > 0 THEN $9::int ELSE $10::int END)`;
  const rate = `(CASE WHEN $9::int > 0 THEN $9::int ELSE COALESCE(voice_usage.overage_cents_per_minute, $10::int) END)`;
  // This call's overage minutes: the part of it above the allowance in force.
  const overNew = `(CASE WHEN $7::int < 0 THEN 0 ELSE GREATEST(0, (CASE WHEN ${waiveNew} THEN 0 ELSE $4::int END) - $7::int) END)`;
  const over = `(CASE WHEN ${allow} < 0 THEN 0 ELSE GREATEST(0, LEAST(${billable}, voice_usage.minutes + ${billable} - ${allow})) END)`;
  const { rows: [r] } = await q.query(
    `INSERT INTO voice_usage (org_id, account_user_id, month, calls, minutes, spam_calls, blocked_calls, included_minutes, overage_minutes,
                              overage_rate_minutes, overage_cents_per_minute, spam_free_calls, spam_free_minutes, updated_at)
     VALUES ($1, $2, $3, 1, CASE WHEN ${waiveNew} THEN 0 ELSE $4::int END, $5::int, $6::int, $7::int,
             ${overNew},
             CASE WHEN ${overNew} > 0 THEN jsonb_build_object(${rateNew}::text, ${overNew}) ELSE '{}'::jsonb END, ${rateNew},
             CASE WHEN ${waiveNew} THEN 1 ELSE 0 END, CASE WHEN ${waiveNew} THEN $4::int ELSE 0 END, now())
     ON CONFLICT (org_id, month) DO UPDATE SET
       account_user_id = EXCLUDED.account_user_id,
       calls = voice_usage.calls + 1,
       minutes = voice_usage.minutes + ${billable},
       spam_calls = voice_usage.spam_calls + EXCLUDED.spam_calls,
       blocked_calls = voice_usage.blocked_calls + EXCLUDED.blocked_calls,
       spam_free_calls = voice_usage.spam_free_calls + (CASE WHEN ${waive} THEN 1 ELSE 0 END),
       spam_free_minutes = voice_usage.spam_free_minutes + (CASE WHEN ${waive} THEN $4::int ELSE 0 END),
       included_minutes = ${allow},
       overage_minutes = voice_usage.overage_minutes + ${over},
       overage_rate_minutes = CASE WHEN ${over} > 0
         THEN voice_usage.overage_rate_minutes || jsonb_build_object(${rate}::text, COALESCE((voice_usage.overage_rate_minutes ->> ${rate}::text)::int, 0) + ${over})
         ELSE voice_usage.overage_rate_minutes END,
       overage_cents_per_minute = ${rate},
       updated_at = now()
     RETURNING *`,
    [input.orgId, input.accountUserId, month, minutes, spam ? 1 : 0, blocked ? 1 : 0, included, Math.max(0, Math.floor(freeSpamCalls)),
      Math.max(0, Math.floor(allowance.overageCentsPerMinute ?? 0)), CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS],
  );
  return rowFrom(r);
}

/** The month's row, or null when nothing was counted yet. */
export async function getVoiceUsageRow(orgId: string, month = voiceMonthKey(), q: Queryable = pool): Promise<VoiceUsageRow | null> {
  const { rows } = await q.query("SELECT * FROM voice_usage WHERE org_id = $1 AND month = $2", [orgId, month]);
  return rows[0] ? rowFrom(rows[0]) : null;
}

/** The last `months` rows, newest first (months with no calls are absent). */
export async function listVoiceUsage(orgId: string, months = 12, q: Queryable = pool): Promise<VoiceUsageRow[]> {
  const { rows } = await q.query("SELECT * FROM voice_usage WHERE org_id = $1 ORDER BY month DESC LIMIT $2", [orgId, Math.max(1, Math.min(36, months))]);
  return rows.map(rowFrom);
}

// ── Overage → Stripe ────────────────────────────────────────────────────────

/** The one-time Price an overage line at `centsPerMinute` is billed on; its key spells the rate, so each rate has its own Price. */
export const voiceOverageLookupKey = (centsPerMinute: number) => `chub_v1_meter_call_minutes_${centsPerMinute}`;

/** The slice of Stripe this module uses (a fake stands in for it in tests). */
export type StripeForOverage = {
  prices: {
    list(params: { lookup_keys: string[]; active: boolean; limit: number }): Promise<{ data: { id: string; unit_amount: number | null; currency: string; recurring?: unknown }[] }>;
    create(params: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<{ id: string }>;
  };
  invoiceItems: {
    create(params: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<{ id: string }>;
  };
  invoices: {
    create(params: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<{ id: string }>;
  };
};

export type OverageReport =
  | { reported: 0; reason: "nothing_to_report" | "stripe_unconfigured" | "no_live_subscription" | "no_customer" }
  | {
      /** Minutes billed this run (every rate). */
      reported: number;
      /** What they cost: each rate's minutes at that rate. */
      reportedCents: number;
      /** One line per rate, highest rate first. */
      lines: { centsPerMinute: number; minutes: number; invoiceItemId: string; invoiceId: string | null }[];
      /** The first line's item (kept for callers that bill one rate). */
      invoiceItemId: string;
      /** Annual only: the first line's invoice (each rate is invoiced on its own; see `lines`). */
      invoiceId: string | null;
    };

const overagePriceIds = new Map<number, string>();
/** Test hook: forget the resolved overage prices. */
export function resetVoiceOveragePriceCache() { overagePriceIds.clear(); }

async function resolveOveragePriceId(stripe: StripeForOverage, centsPerMinute: number): Promise<string> {
  const cached = overagePriceIds.get(centsPerMinute);
  if (cached) return cached;
  const lookupKey = voiceOverageLookupKey(centsPerMinute);
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  let id = found.data.find((p) => p.currency === "usd" && p.unit_amount === centsPerMinute && !p.recurring)?.id;
  if (!id) {
    const created = await stripe.prices.create(
      {
        currency: "usd",
        unit_amount: centsPerMinute,
        lookup_key: lookupKey,
        transfer_lookup_key: true,
        product_data: { name: `ConstructHUB add-on — ${CALL_ASSISTANT_NAME} minutes over the included allowance` },
        metadata: { chub_kind: "meter", chub_key: "call_minutes", chub_interval: "once", chub_cents_per_minute: String(centsPerMinute) },
      },
      { idempotencyKey: `chub-price-${lookupKey}` },
    );
    id = created.id;
  }
  overagePriceIds.set(centsPerMinute, id);
  return id;
}

/** "$0.10" / "$0.05" — a per-minute rate in an invoice line. */
const perMinute = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export type OverageSubscription = { stripeCustomerId: string | null; stripeSubscriptionId: string | null; status: string; billingInterval: string | null };

export type OverageDeps = {
  stripe?: StripeForOverage;
  /** The owner's subscription row (defaults to the subscriptions table). */
  subscriptionFor?: (userId: number) => Promise<OverageSubscription | null>;
  configured?: () => boolean;
  q?: Queryable;
};

async function defaultSubscriptionFor(userId: number): Promise<OverageSubscription | null> {
  const { rows: [r] } = await pool.query(
    // The same row getEntitlements reads (server/entitlements.ts SUBSCRIPTION_ORDER): one with access wins, then the newest.
    "SELECT stripe_customer_id, stripe_subscription_id, status, billing_interval FROM subscriptions WHERE user_id = $1 ORDER BY (status = ANY($2::text[])) DESC, id DESC LIMIT 1",
    [userId, [...ACCESS_STATUSES]],
  );
  return r ? { stripeCustomerId: r.stripe_customer_id ?? null, stripeSubscriptionId: r.stripe_subscription_id ?? null, status: String(r.status ?? ""), billingInterval: r.billing_interval ?? null } : null;
}

/**
 * Bill the month's not-yet-reported overage minutes: one invoice item per
 * rate bucket (Lite/Solo minutes at their rate, Crew/Fleet minutes at
 * theirs), each the bucket's minutes above what was already reported. Safe to
 * call repeatedly (nothing new → nothing sent); the worker below sweeps last
 * month on the 1st and after. Without Stripe or a live subscription it
 * reports nothing and says why — the minutes stay on the row for a later run.
 */
export async function reportVoiceOverage(orgId: string, month: string, deps: OverageDeps = {}): Promise<OverageReport> {
  const q = deps.q ?? pool;
  const row = await getVoiceUsageRow(orgId, month, q);
  if (!row || row.overageMinutes - row.overageReportedMinutes <= 0) return { reported: 0, reason: "nothing_to_report" };
  // Each rate's unreported minutes (summarizeVoiceUsage prices un-bucketed overage at the month's rate).
  const summary = summarizeVoiceUsage(row, month, 0);
  const reportedByRate = new Map(buckets(row.overageReportedRateMinutes));
  let unbucketedReported = Math.max(0, row.overageReportedMinutes - [...reportedByRate.values()].reduce((n, m) => n + m, 0));
  const pending: { rate: number; from: number; upTo: number }[] = [];
  for (const { centsPerMinute: rate, minutes } of summary.overageByRate) {
    let from = reportedByRate.get(rate) ?? 0;
    // Minutes reported before per-rate buckets existed count against the month's rate.
    if (rate === summary.overageCentsPerMinute && unbucketedReported > 0) { from += unbucketedReported; unbucketedReported = 0; }
    if (minutes > from) pending.push({ rate, from, upTo: minutes });
  }
  if (!pending.length) return { reported: 0, reason: "nothing_to_report" };
  if (!(deps.configured ?? stripeConfigured)()) return { reported: 0, reason: "stripe_unconfigured" };
  const sub = await (deps.subscriptionFor ?? defaultSubscriptionFor)(row.accountUserId);
  if (!sub || !hasLiveStripeSubscription(sub)) return { reported: 0, reason: "no_live_subscription" };
  if (!sub.stripeCustomerId) return { reported: 0, reason: "no_customer" };
  const stripe = deps.stripe ?? (stripeClient as unknown as StripeForOverage);
  const annual = sub.billingInterval === "year";
  const lines: { centsPerMinute: number; minutes: number; invoiceItemId: string; invoiceId: string | null }[] = [];
  // Bucket by bucket: each rate is sent, (annual) invoiced, then recorded as billed before the next rate is
  // touched. A failure on a later rate leaves the earlier ones recorded, so a retry re-sends only the rates
  // that were not billed — never relying on Stripe's 24-hour idempotency window for minutes already billed.
  for (const { rate, from, upTo } of pending) {
    const price = await resolveOveragePriceId(stripe, rate);
    const delta = upTo - from;
    const description = `${CALL_ASSISTANT_NAME}: ${delta} minute${delta === 1 ? "" : "s"} over the included minutes in ${month}, at ${perMinute(rate)} a minute`;
    const key = `chub-voice-overage-${orgId}-${month}-r${rate}-${upTo}`;
    const item = await stripe.invoiceItems.create(
      {
        customer: sub.stripeCustomerId,
        // Monthly: ride the subscription's next invoice. Annual: left unattached and invoiced now (below).
        ...(annual ? {} : { subscription: sub.stripeSubscriptionId ?? undefined }),
        pricing: { price },
        quantity: delta,
        description,
        metadata: { chub_kind: "voice_overage", chub_org: orgId, chub_month: month, chub_minutes: String(delta), chub_cents_per_minute: String(rate) },
      },
      // One item per (org, month, rate, running total): a retry after a crash never bills the same minutes twice.
      { idempotencyKey: key },
    );
    let invoiceId: string | null = null;
    if (annual) {
      // Invoiced before the bucket is recorded: a failure here leaves it unrecorded, so the retry
      // re-sends this item (same key) and invoices it — a recorded bucket is always invoiced.
      const invoice = await stripe.invoices.create(
        {
          customer: sub.stripeCustomerId,
          pending_invoice_items_behavior: "include",
          collection_method: "charge_automatically",
          auto_advance: true,
          description,
          metadata: { chub_kind: "voice_overage", chub_org: orgId, chub_month: month },
        },
        { idempotencyKey: `${key}-invoice` },
      );
      invoiceId = invoice.id;
    }
    lines.push({ centsPerMinute: rate, minutes: delta, invoiceItemId: item.id, invoiceId });
    await q.query(
      `UPDATE voice_usage SET overage_reported_minutes = $3,
         overage_reported_rate_minutes = overage_reported_rate_minutes || jsonb_build_object($4::text, $5::int),
         overage_reported_at = now(), stripe_usage_record_id = $6, updated_at = now() WHERE org_id = $1 AND month = $2`,
      [orgId, month, row.overageReportedMinutes + lines.reduce((n, l) => n + l.minutes, 0), String(rate), upTo, lines.map((l) => l.invoiceItemId).join(",")],
    );
  }
  const reported = lines.reduce((n, l) => n + l.minutes, 0);
  const reportedCents = lines.reduce((n, l) => n + l.minutes * l.centsPerMinute, 0);
  const invoiceId = lines.find((l) => l.invoiceId)?.invoiceId ?? null;
  return { reported, reportedCents, lines, invoiceItemId: lines[0].invoiceItemId, invoiceId };
}

/** "YYYY-MM" of the month before `now` (UTC). */
export const previousVoiceMonth = (now = new Date()) => voiceMonthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));

/** Every org with unreported overage for `month` (default: last month, for a sweep on the 1st). */
export async function reportAllVoiceOverage(month?: string, deps: OverageDeps = {}): Promise<{ month: string; orgs: number; reportedMinutes: number; reportedCents: number; skipped: Record<string, number> }> {
  const q = deps.q ?? pool;
  const target = month ?? previousVoiceMonth();
  const { rows } = await q.query("SELECT org_id FROM voice_usage WHERE month = $1 AND overage_minutes > overage_reported_minutes", [target]);
  let orgs = 0, reportedMinutes = 0, reportedCents = 0;
  const skipped: Record<string, number> = {};
  for (const r of rows) {
    try {
      const out = await reportVoiceOverage(r.org_id, target, deps);
      if (out.reported > 0 && "reportedCents" in out) { orgs += 1; reportedMinutes += out.reported; reportedCents += out.reportedCents; }
      else if ("reason" in out) skipped[out.reason] = (skipped[out.reason] ?? 0) + 1;
    } catch (e: any) {
      skipped.error = (skipped.error ?? 0) + 1;
      console.error(`[voice-usage] overage report failed for org ${r.org_id} ${target}:`, e?.message || e);
    }
  }
  return { month: target, orgs, reportedMinutes, reportedCents, skipped };
}

// ── The sweep worker (started from registerVoiceRoutes in server/voice/index.ts) ──

const SWEEP_EVERY_MS = 6 * 60 * 60_000;
const SWEEP_FIRST_DELAY_MS = 10 * 60_000;
let sweepStarted = false;

/** Why the overage sweep is off, or null when it runs (production + Stripe + the explicit switch). */
export function voiceOverageWorkerOffReason(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.VOICE_OVERAGE_WORKER_ENABLED !== "true") return "VOICE_OVERAGE_WORKER_ENABLED is not true";
  if (!env.STRIPE_SECRET_KEY) return "STRIPE_SECRET_KEY is not set";
  if (env.NODE_ENV !== "production") return "this is not a production server";
  return null;
}

/**
 * Every 6 hours, bill last month's unreported overage (idempotent, so the
 * repeats are no-ops once a month is billed; a Stripe outage on the 1st is
 * retried on the next run). Off in tests and anywhere the switch is off.
 */
export function startVoiceOverageWorker(): void {
  if (sweepStarted || process.env.NODE_ENV === "test" || process.env.VITEST) return;
  sweepStarted = true;
  const off = voiceOverageWorkerOffReason();
  if (off) {
    console.log(`[voice-usage] Call Assistant overage billing is off: ${off}.`);
    return;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const out = await reportAllVoiceOverage();
      if (out.orgs || Object.keys(out.skipped).length) console.log(`[voice-usage] overage ${out.month}: billed ${out.reportedMinutes} min ($${(out.reportedCents / 100).toFixed(2)}) for ${out.orgs} org(s); skipped ${JSON.stringify(out.skipped)}`);
    } catch (e: any) {
      console.error("[voice-usage] overage sweep failed:", e?.message || e);
    } finally { running = false; }
  };
  setTimeout(run, SWEEP_FIRST_DELAY_MS).unref();
  setInterval(run, SWEEP_EVERY_MS).unref();
}
