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
 * overageCentsPerMinute: 50¢ on every tier since 2026-10-08) on the owner's
 * next Stripe invoice. Each call's overage minutes go into the bucket of its
 * rate (overage_rate_minutes, {"50": 30}), so a month that spans a rate change
 * bills every call at its own rate. The service costs ConstructHUB about 20¢ a
 * minute (the SignalWire AI agent) — an internal figure, never in any copy.
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
 * Overage reaches Stripe as an invoice item on the Call Assistant's OWN
 * subscription (server/voice/subscription-store.ts — the service is sold apart
 * from the platform plans) and its customer (`stripe.invoiceItems.create`
 * with `pricing.price` = a one-time Price found by lookup key, the
 * server/billing/prices.ts pattern). stripe-node 20 has no usage records any
 * more, and a Billing Meter would add a foreign subscription item; an invoice
 * item touches nothing on the subscription. A monthly subscription picks it
 * up on its next invoice; an ANNUAL one would hold it for up to a year, so
 * for those each rate's item is invoiced on its own right away.
 * Reporting is idempotent per month and rate: only each bucket's minutes above
 * its reported count (overage_reported_rate_minutes) are ever sent, one invoice
 * item per rate (Stripe idempotency key per rate and running total), and each
 * bucket is recorded as billed as soon as Stripe has it, so a failure on one
 * rate never re-sends another.
 *
 * Every range of minutes billed is CLAIMED first (voice_overage_claims, below):
 * a row per (org, month, rate, range) written under the account's database
 * lock (server/billing/locks.ts) in one transaction with the meter's
 * accounting marker ("reported" = claimed), BEFORE any Stripe call; the Stripe
 * call is made outside the lock with the claim's own, immutable parameters;
 * the outcome is recorded under the lock; and a claim whose outcome is
 * unknown (a crash) is reconciled against Stripe — the item carries the claim
 * id in its metadata — before anything is created again. So the sweep, the
 * monthly report and the settlement at cancellation, even running at once or
 * crashing half-way, never bill the same minutes twice.
 *
 * Overage is never lost when the subscription ends: its end is recorded in
 * the SAME transaction as a settlement job (voice_settle_jobs,
 * enqueueVoiceSettlement from server/voice/subscription.ts); the job claims
 * every outstanding month, re-aims the subscription's unfinished claims at
 * the customer (an ended subscription takes no items) and invoices now every
 * claim still queued for the subscription's invoice that will never come. It
 * runs right away and, if it fails, is recorded and retried by every sweep —
 * which also covers every finished month, every unfinished claim, and any
 * queued claim left on an ended subscription without a job.
 */
import { pool } from "../db";
import { getEntitlements, callAssistantAllowance } from "../entitlements";
import { stripe as stripeClient, stripeConfigured } from "../billing/client";
import { hasLiveStripeSubscription, LIVE_STATUSES } from "../billing/sync";
import { callAssistantSubscriptionRow } from "./subscription-store";
import { CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS, CALL_ASSISTANT_FREE_SPAM_CALLS, CALL_ASSISTANT_NAME } from "@shared/plans";
import type { VoiceUsageRow } from "@shared/schema";
import { recordFailure } from "../ops/issues";
import { withCallAssistantLock } from "../billing/locks";
import { VOICE_SCHEMA_DDL } from "./schema";

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
    overageReportedAt: r.overage_reported_at, stripeUsageRecordId: r.stripe_usage_record_id, stripeSubscriptionId: r.stripe_subscription_id ?? null, updatedAt: r.updated_at,
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
  const ent = await getEntitlements(input.accountUserId);
  const allowance = callAssistantAllowance(ent);
  const included = allowance.minutes;
  // The subscription this month's latest call was under: a settlement claims only its own subscription's months.
  const subscriptionId = ent.callAssistant.stripeSubscriptionId ?? null;
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
                              overage_rate_minutes, overage_cents_per_minute, spam_free_calls, spam_free_minutes, stripe_subscription_id, updated_at)
     VALUES ($1, $2, $3, 1, CASE WHEN ${waiveNew} THEN 0 ELSE $4::int END, $5::int, $6::int, $7::int,
             ${overNew},
             CASE WHEN ${overNew} > 0 THEN jsonb_build_object(${rateNew}::text, ${overNew}) ELSE '{}'::jsonb END, ${rateNew},
             CASE WHEN ${waiveNew} THEN 1 ELSE 0 END, CASE WHEN ${waiveNew} THEN $4::int ELSE 0 END, $11, now())
     ON CONFLICT (org_id, month) DO UPDATE SET
       account_user_id = EXCLUDED.account_user_id,
       stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, voice_usage.stripe_subscription_id),
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
      Math.max(0, Math.floor(allowance.overageCentsPerMinute ?? 0)), CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS, subscriptionId],
  );
  return rowFrom(r);
}

// ── The metering record: one call counted exactly once ─────────────────────

/** What the meter record needs of a pool: a client for its transaction. */
export type MeterPool = Queryable & { connect(): Promise<Queryable & { release(err?: Error): void }> };

export type MeterCallInput = RecordUsageInput & { callId: string };

/**
 * Meter one finished call exactly once (audit #5): a `voice_call_meter` row
 * per call id is written first (`pending`; a repeat is a no-op), then, in ONE
 * transaction, the row moves to `done` and the month's upsert runs — so a
 * crash or a failed upsert leaves the row `pending` and nothing counted, and a
 * second report of the same call counts nothing again. A failure is recorded
 * on the row (attempts, error) and thrown; the retry worker
 * (retryPendingVoiceMeters) finishes it. Returns the month's row.
 */
export async function meterVoiceCall(input: MeterCallInput, p: MeterPool = pool as unknown as MeterPool, freeSpamCalls = CALL_ASSISTANT_FREE_SPAM_CALLS): Promise<VoiceUsageRow> {
  const month = voiceMonthKey(input.at ?? new Date());
  const minutes = isBlockedOutcome(input.outcome) ? 0 : (input.billedMinutes ?? billedMinutesFor(input.durationSeconds));
  await p.query(
    `INSERT INTO voice_call_meter (call_id, org_id, account_user_id, outcome, billed_minutes, started_at, state)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending') ON CONFLICT (call_id) DO NOTHING`,
    [input.callId, input.orgId, input.accountUserId, input.outcome ?? null, minutes, input.at ?? new Date()]);
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const { rows: [taken] } = await client.query(`UPDATE voice_call_meter SET state = 'done', metered_at = now(), attempts = attempts + 1, error = NULL, updated_at = now() WHERE call_id = $1 AND state = 'pending' RETURNING call_id`, [input.callId]);
    if (!taken) {
      // Already counted (a repeat of the end report, or the retry worker got here first): nothing counts twice.
      await client.query("ROLLBACK");
      return (await getVoiceUsageRow(input.orgId, month, p)) ?? (await recordVoiceCallUsage({ ...input, billedMinutes: 0, outcome: "blocked" }, p, freeSpamCalls));
    }
    const row = await recordVoiceCallUsage({ orgId: input.orgId, accountUserId: input.accountUserId, outcome: input.outcome, billedMinutes: minutes, at: input.at }, client, freeSpamCalls);
    await client.query("COMMIT");
    return row;
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    await p.query(`UPDATE voice_call_meter SET attempts = attempts + 1, error = $2, updated_at = now() WHERE call_id = $1 AND state = 'pending'`, [input.callId, String(e?.message || e).slice(0, 300)]).catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Meter again every call whose metering is still pending (a failed upsert, a crash): each counted exactly once.
 * Recovers from the CALL rows too (audit #6): a processed call flagged meterPending with no meter record (the task
 * row could not be written) gets its record from the call itself (minutes, outcome, the org's owner) first.
 */
export async function retryPendingVoiceMeters(p: MeterPool = pool as unknown as MeterPool, limit = 500): Promise<{ pending: number; metered: number; failed: number }> {
  const { rows: [has] } = await p.query("SELECT to_regclass('public.crm_orgs') IS NOT NULL AND to_regclass('public.voice_calls') IS NOT NULL AS ok");
  if (has?.ok) {
    await p.query(
      `INSERT INTO voice_call_meter (call_id, org_id, account_user_id, outcome, billed_minutes, started_at, state)
       SELECT c.id, c.org_id, o.owner_user_id, c.outcome, coalesce(c.billed_minutes, 0), coalesce(c.started_at, c.ended_at, now()), 'pending'
         FROM voice_calls c JOIN crm_orgs o ON o.id = c.org_id
        WHERE coalesce(c.flags->>'meterPending', '') = 'true' AND coalesce(c.flags->>'processedAt', '') <> ''
          AND NOT EXISTS (SELECT 1 FROM voice_call_meter m WHERE m.call_id = c.id)
       ON CONFLICT (call_id) DO NOTHING`);
  }
  const { rows } = await p.query("SELECT call_id, org_id, account_user_id, outcome, billed_minutes, started_at FROM voice_call_meter WHERE state = 'pending' ORDER BY created_at LIMIT $1", [limit]);
  let metered = 0, failed = 0;
  for (const r of rows) {
    try {
      await meterVoiceCall({ callId: r.call_id, orgId: r.org_id, accountUserId: Number(r.account_user_id), outcome: r.outcome, billedMinutes: Number(r.billed_minutes), at: r.started_at ? new Date(r.started_at) : undefined }, p);
      if (has?.ok) await p.query(`UPDATE voice_calls SET flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object('meterPending', false, 'metered', $2::int) WHERE id = $1`, [r.call_id, Number(r.billed_minutes)]).catch(() => {});
      metered++;
    } catch (e: any) {
      failed++;
      console.error(`[voice-usage] metering retry failed for call ${r.call_id}:`, e?.message || e);
      void recordFailure("call_assistant", "Call Assistant usage metering (retry)", e, { callId: r.call_id, orgId: r.org_id });
    }
  }
  return { pending: rows.length, metered, failed };
}

const METER_RETRY_EVERY_MS = 15 * 60_000;
const METER_RETRY_FIRST_DELAY_MS = 2 * 60_000;
let meterRetryStarted = false;
/** Every 15 minutes (and 2 minutes after boot): meter the calls whose metering is still pending. On unless VOICE_METER_RETRY_WORKER_ENABLED=false; off in tests. Independent of the overage switch. */
export function startVoiceMeterRetryWorker(): void {
  if (meterRetryStarted || process.env.NODE_ENV === "test" || process.env.VITEST) return;
  meterRetryStarted = true;
  if (process.env.VOICE_METER_RETRY_WORKER_ENABLED === "false") { console.log("[voice-usage] the metering retry worker is off (VOICE_METER_RETRY_WORKER_ENABLED=false)."); return; }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const out = await retryPendingVoiceMeters();
      if (out.pending) console.log(`[voice-usage] metering retried: ${JSON.stringify(out)}`);
    } catch (e: any) {
      console.error("[voice-usage] metering retry sweep failed:", e?.message || e);
      void recordFailure("job", "Call Assistant metering retry sweep", e);
    } finally { running = false; }
  };
  setTimeout(run, METER_RETRY_FIRST_DELAY_MS).unref();
  setInterval(run, METER_RETRY_EVERY_MS).unref();
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
    /** Reconciliation: a claim sent before and left without its item looks for it (every page) before creating again. */
    list?(params: { customer: string; limit: number; starting_after?: string }): Promise<{ data: StripeInvoiceItemLike[]; has_more?: boolean }>;
    /** A claim with its item but no invoice asks whether the item already sits on one. */
    retrieve?(id: string): Promise<StripeInvoiceItemLike>;
  };
  invoices: {
    create(params: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<{ id: string }>;
    /** The invoice's own lines: the only source for which claims an invoice carries. */
    listLineItems(invoiceId: string, params: { limit: number; starting_after?: string }): Promise<{ data: { id: string; invoice_item?: string | { id: string } | null }[]; has_more?: boolean }>;
  };
};
export type StripeInvoiceItemLike = {
  id: string; metadata?: Record<string, string> | null; invoice?: string | { id: string } | null;
  customer?: string | { id: string } | null; subscription?: string | { id: string } | null; quantity?: number | null;
};

export type OverageReport =
  | { reported: 0; reason: "nothing_to_report" | "stripe_unconfigured" | "no_customer" | "billing_off" }
  | {
      /** Minutes billed this run (every rate). */
      reported: number;
      /** What they cost: each rate's minutes at that rate. */
      reportedCents: number;
      /** One line per claim (a retried one first, then each rate's new range, highest rate first). */
      lines: { centsPerMinute: number; minutes: number; invoiceItemId: string; invoiceId: string | null; claimId: number }[];
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
        product_data: { name: `ConstructHUB ${CALL_ASSISTANT_NAME} — minutes over the included allowance` },
        metadata: { chub_kind: "meter", chub_key: "call_minutes", chub_interval: "once", chub_cents_per_minute: String(centsPerMinute) },
      },
      { idempotencyKey: `chub-price-${lookupKey}` },
    );
    id = created.id;
  }
  overagePriceIds.set(centsPerMinute, id);
  return id;
}

export type OverageSubscription = { stripeCustomerId: string | null; stripeSubscriptionId: string | null; status: string; billingInterval: string | null };

export type OverageDeps = {
  stripe?: StripeForOverage;
  /** The owner's Call Assistant subscription row (defaults to call_assistant_subscriptions). */
  subscriptionFor?: (userId: number) => Promise<OverageSubscription | null>;
  configured?: () => boolean;
  /** The account's lock (default: the database lock, withCallAssistantLock); a unit test with a mocked database hands in a pass-through. */
  lock?: <T>(userId: number, run: () => Promise<T>) => Promise<T>;
};
const lockFor = (deps: OverageDeps) => deps.lock ?? withCallAssistantLock;
const stripeFor = (deps: OverageDeps) => deps.stripe ?? (stripeClient as unknown as StripeForOverage);
const configuredFor = (deps: OverageDeps) => (deps.configured ?? stripeConfigured)();

// ── The safety switch ───────────────────────────────────────────────────────

/**
 * CALL_ASSISTANT_OVERAGE_BILLING = "on" | "off", default OFF (the owner goes
 * live without the overage machinery having to be perfect). Off: minutes and
 * overage are metered and shown everywhere (usage, the billing card says
 * "Minutes above your plan are not charged yet", the admin card), but no
 * Stripe item or invoice is ever created and no settlement job runs — jobs
 * and claims are recorded as they come, so turning it on later processes
 * them. Tier subscriptions, checkout and entitlements are not affected.
 */
export type OverageBillingState = "on" | "off";
export function voiceOverageBillingState(env: NodeJS.ProcessEnv = process.env): OverageBillingState {
  return (env.CALL_ASSISTANT_OVERAGE_BILLING ?? "").trim().toLowerCase() === "on" ? "on" : "off";
}
const overageBillingOn = () => voiceOverageBillingState() === "on";

/** The Call Assistant's own subscription — the one the overage rides on (never the platform plan's). An ended one still names its customer. */
async function defaultSubscriptionFor(userId: number): Promise<OverageSubscription | null> {
  const r = await callAssistantSubscriptionRow(userId);
  return r ? { stripeCustomerId: r.stripe_customer_id ?? null, stripeSubscriptionId: r.stripe_subscription_id ?? null, status: String(r.status ?? ""), billingInterval: r.billing_interval ?? null } : null;
}

/** A few statements in one database transaction on a connection of their own (the lock's own connection only holds the lock). */
async function withTransaction<T>(run: (c: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await run(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ── Claims: the unit of billing work ────────────────────────────────────────

/**
 * One row per range of an org-month's overage minutes at one rate, the UNIT OF
 * WORK of overage billing (Codex audits #2–#4, 2026-10-09). Written under the
 * account's lock BEFORE anything is sent to Stripe, in ONE transaction with
 * the meter's accounting marker (voice_usage.overage_reported_*: "reported" =
 * claimed), so a claim and its accounting can never disagree; the next claim
 * starts where the last one ended (a UNIQUE on the range start, CHECKs on the
 * range, the quantity and the rate, an EXCLUDE on overlapping ranges where
 * btree_gist could be installed, and the claim function re-checks for overlap).
 * Every parameter the Stripe request needs is on the claim — customer, the
 * subscription it was created under (its ORIGIN, never changed), interval,
 * whether it is billed on the customer rather than queued for that
 * subscription's invoice, rate, minutes, the idempotency key, and a UUID
 * (claim_uid) that goes into the item's metadata — so a retry bills exactly
 * what was claimed, never the account's subscription of today. Its state
 * follows the Stripe work:
 *   creating → claimed, the item not yet known to be at Stripe
 *   queued   → the item is on the live monthly subscription's next invoice
 *   invoiced → an invoice carries it (verified from the invoice's own lines)
 *   failed   → a Stripe call failed; retried AS IS on the next run
 * A claim that was ever sent and is left `creating` or `failed` without an
 * item (a crash between the Stripe call and the record) is RECONCILED before
 * anything is created again: every invoice item of the customer is read
 * (every page; an unfinished listing fails closed and the claim waits) and
 * one is adopted only when its customer, subscription, org, month, quantity,
 * rate, kind and claim UUID all match the stored request. A lease
 * (leased_until + a token) keeps two processors off one claim, and a stale
 * processor's record is dropped by the token. The table's DDL lives with the
 * other voice tables (server/voice/schema.ts).
 */
export const VOICE_OVERAGE_CLAIMS_DDL: readonly string[] = VOICE_SCHEMA_DDL.filter((ddl) => /voice_overage_claims|voice_settle_jobs|btree_gist/.test(ddl));

let claimsReady: Promise<void> | null = null;
/**
 * The claims and settle-job tables exist before the first claim. A failure is logged, the caller gets the
 * error (nothing runs on a half-made schema), and the next call tries again.
 */
export function voiceOverageClaimsReady(): Promise<void> {
  claimsReady ??= (async () => {
    for (const ddl of VOICE_OVERAGE_CLAIMS_DDL) await pool.query(ddl);
  })().catch((e: any) => {
    console.error("[voice-usage] could not create the overage claim tables:", e?.message || e);
    claimsReady = null;
    throw e;
  });
  return claimsReady;
}

export type OverageClaimState = "creating" | "queued" | "invoiced" | "failed";
export type OverageClaim = {
  id: number; uid: string; orgId: string; accountUserId: number; month: string; centsPerMinute: number; fromMinutes: number; toMinutes: number; minutes: number;
  state: OverageClaimState; stripeCustomerId: string | null;
  /** The subscription the claim was created under — its origin, kept whatever happens to that subscription later. */
  stripeSubscriptionId: string | null; billingInterval: string | null;
  /** Invoiced on its own on the customer (annual, or the subscription ended) rather than queued for the origin subscription's next invoice. */
  billedOnCustomer: boolean;
  idempotencyKey: string; stripeInvoiceItemId: string | null; stripeInvoiceId: string | null; error: string | null; attempts: number;
  /** The processor holding the claim right now (null when free). */
  leaseToken: string | null;
};
const claimFrom = (r: any): OverageClaim => ({
  id: Number(r.id), uid: String(r.claim_uid), orgId: r.org_id, accountUserId: Number(r.account_user_id), month: r.month, centsPerMinute: Number(r.cents_per_minute),
  fromMinutes: Number(r.from_minutes), toMinutes: Number(r.to_minutes), minutes: Number(r.minutes ?? Number(r.to_minutes) - Number(r.from_minutes)),
  // Rows from before the `creating` state were written as `pending`: the same thing.
  state: r.state === "pending" ? "creating" : r.state, stripeCustomerId: r.stripe_customer_id ?? null, stripeSubscriptionId: r.stripe_subscription_id ?? null,
  billingInterval: r.billing_interval ?? null, billedOnCustomer: Boolean(r.billed_on_customer ?? r.invoice_now),
  idempotencyKey: r.idempotency_key ?? claimKey({ orgId: r.org_id, month: r.month, centsPerMinute: Number(r.cents_per_minute), toMinutes: Number(r.to_minutes) }),
  stripeInvoiceItemId: r.stripe_invoice_item_id ?? null, stripeInvoiceId: r.stripe_invoice_id ?? null, error: r.error ?? null, attempts: Number(r.attempts ?? 0),
  leaseToken: r.lease_token ?? null,
});
/** Still to be done at Stripe: the item not recorded, or a failed attempt. */
const unfinished = (c: OverageClaim) => c.state === "creating" || c.state === "failed";
/** How long a processor holds a claim or a job it took (its Stripe call in flight); a lease that ran out frees it. */
const LEASE_MINUTES = 10;
/**
 * Take claims for this processor, under the lock: those not leased (or whose lease ran out) are leased now
 * with a fresh token and returned; one another processor holds is left to it. The token fences every later
 * write of this processor: a record from a lease that was lost changes nothing.
 */
async function leaseClaims(ids: number[]): Promise<OverageClaim[]> {
  if (!ids.length) return [];
  const { rows } = await pool.query(
    `UPDATE voice_overage_claims SET leased_until = now() + ($2::int * interval '1 minute'), lease_token = gen_random_uuid(), updated_at = now()
      WHERE id = ANY($1::int[]) AND state IN ('creating', 'pending', 'failed') AND (leased_until IS NULL OR leased_until < now()) RETURNING *`,
    [ids, LEASE_MINUTES]);
  return rows.map(claimFrom);
}

/** Every claim of an org-month, oldest first. */
export async function listVoiceOverageClaims(orgId: string, month: string): Promise<OverageClaim[]> {
  await voiceOverageClaimsReady();
  const { rows } = await pool.query("SELECT * FROM voice_overage_claims WHERE org_id = $1 AND month = $2 ORDER BY id", [orgId, month]);
  return rows.map(claimFrom);
}

/** "$0.50" — a per-minute rate in an invoice line. */
const perMinute = (cents: number) => `$${(cents / 100).toFixed(2)}`;
/** The Stripe idempotency key of a claim's item: the range end is what makes it one of a kind per org, month and rate. */
const claimKey = (c: Pick<OverageClaim, "orgId" | "month" | "centsPerMinute" | "toMinutes">) => `chub-voice-overage-${c.orgId}-${c.month}-r${c.centsPerMinute}-${c.toMinutes}`;
const claimDescription = (c: OverageClaim) => `${CALL_ASSISTANT_NAME}: ${c.minutes} minute${c.minutes === 1 ? "" : "s"} over the included minutes in ${c.month}, at ${perMinute(c.centsPerMinute)} a minute`;
/** The item's metadata: everything the reconciliation matches on, the claim's UUID first. */
const claimMetadata = (c: OverageClaim) => ({
  chub_kind: "voice_overage", chub_claim: c.uid, chub_org: c.orgId, chub_month: c.month, chub_minutes: String(c.minutes),
  chub_cents_per_minute: String(c.centsPerMinute), chub_account: String(c.accountUserId),
});

/**
 * Claim the org-month's not-yet-claimed overage, under the account's lock,
 * DATABASE WORK ONLY: one new claim per rate bucket for the minutes above the
 * last claim, each with the Stripe request it will make (the subscription as
 * of now: queued for a live monthly one, billed on the customer otherwise),
 * in ONE transaction with the meter's accounting marker. Returns every claim of
 * the month still to be done at Stripe (the new ones and earlier unfinished
 * ones), leased to this processor, or why nothing is to be done. With the
 * switch off nothing is claimed: the minutes wait on the meter.
 */
export async function claimVoiceOverage(orgId: string, month: string, deps: OverageDeps = {}): Promise<{ claims: OverageClaim[]; reason?: "nothing_to_report" | "stripe_unconfigured" | "no_customer" | "billing_off" }> {
  await voiceOverageClaimsReady();
  if (!overageBillingOn()) return { claims: [], reason: "billing_off" };
  const first = await getVoiceUsageRow(orgId, month);
  if (!first) return { claims: [], reason: "nothing_to_report" };
  return lockFor(deps)(first.accountUserId, async () => {
    const row = (await getVoiceUsageRow(orgId, month))!;
    const claims = await listVoiceOverageClaims(orgId, month);
    // Earlier unfinished claims are taken (leased) here, so no second processor works the same claim.
    const work = await leaseClaims(claims.filter(unfinished).map((c) => c.id));
    // New ranges: each rate's minutes above the last claim of that rate — or above what the meter recorded as
    // reported before claims existed (minutes billed by the earlier code count as claimed).
    const summary = summarizeVoiceUsage(row, month, 0);
    const reportedByRate = new Map(buckets(row.overageReportedRateMinutes));
    let unbucketedReported = Math.max(0, row.overageReportedMinutes - [...reportedByRate.values()].reduce((n, m) => n + m, 0));
    const fresh: { rate: number; from: number; upTo: number }[] = [];
    for (const { centsPerMinute: rate, minutes } of summary.overageByRate) {
      let from = reportedByRate.get(rate) ?? 0;
      if (rate === summary.overageCentsPerMinute && unbucketedReported > 0) { from += unbucketedReported; unbucketedReported = 0; }
      for (const c of claims) if (c.centsPerMinute === rate) from = Math.max(from, c.toMinutes);
      if (minutes > from) fresh.push({ rate, from, upTo: minutes });
    }
    if (!work.length && !fresh.length) return { claims: [], reason: "nothing_to_report" };
    if (!configuredFor(deps)) return { claims: [], reason: "stripe_unconfigured" };
    if (!fresh.length) return { claims: work };
    const sub = await (deps.subscriptionFor ?? defaultSubscriptionFor)(row.accountUserId);
    if (!sub?.stripeCustomerId) return { claims: work, reason: "no_customer" };
    // Billed on the customer right away unless a live MONTHLY subscription will carry it on its next invoice:
    // an annual one would hold it for up to a year, an ended one takes no more items.
    const billedOnCustomer = sub.billingInterval === "year" || !hasLiveStripeSubscription(sub);
    const created = await withTransaction(async (c) => {
      const out: OverageClaim[] = [];
      for (const r of fresh) {
        // Defence in depth beside the lock, the UNIQUE and the EXCLUDE: no claim of this rate may overlap the new range.
        const { rows: overlap } = await c.query(
          "SELECT id FROM voice_overage_claims WHERE org_id = $1 AND month = $2 AND cents_per_minute = $3 AND from_minutes < $5 AND to_minutes > $4 LIMIT 1",
          [orgId, month, r.rate, r.from, r.upTo]);
        if (overlap.length) throw new Error(`overage claim ${overlap[0].id} overlaps [${r.from}, ${r.upTo}) for ${orgId} ${month} r${r.rate}`);
        // Leased to this processor from birth: a report running beside this one finds it taken.
        const { rows: [ins] } = await c.query(
          `INSERT INTO voice_overage_claims
             (org_id, account_user_id, month, cents_per_minute, from_minutes, to_minutes, minutes, state, stripe_customer_id, stripe_subscription_id,
              billing_interval, billed_on_customer, invoice_now, idempotency_key, leased_until, lease_token)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'creating', $8, $9, $10, $11, $11, $12, now() + ($13::int * interval '1 minute'), gen_random_uuid()) RETURNING *`,
          [orgId, row.accountUserId, month, r.rate, r.from, r.upTo, r.upTo - r.from, sub.stripeCustomerId, sub.stripeSubscriptionId,
            sub.billingInterval, billedOnCustomer, claimKey({ orgId, month, centsPerMinute: r.rate, toMinutes: r.upTo }), LEASE_MINUTES]);
        // The meter's accounting marker, in the same transaction: these minutes are claimed exactly once.
        await c.query(
          `UPDATE voice_usage SET overage_reported_minutes = overage_reported_minutes + $3,
             overage_reported_rate_minutes = overage_reported_rate_minutes || jsonb_build_object($4::text, $5::int),
             overage_reported_at = now(), updated_at = now() WHERE org_id = $1 AND month = $2`,
          [orgId, month, r.upTo - r.from, String(r.rate), r.upTo]);
        out.push(claimFrom(ins));
      }
      return out;
    });
    return { claims: [...work, ...created] };
  });
}

/** The listing of the customer's items could not be completed: the claim waits (fails closed) rather than risk a second item. */
export class ReconcileIncompleteError extends Error {
  constructor(readonly claimId: number) { super(`reconcile_incomplete: claim ${claimId}`); this.name = "ReconcileIncompleteError"; }
}
const RECONCILE_PAGES_MAX = 200;

/**
 * Stripe's invoice items for the customer, EVERY page, looking for the one that is this claim: adopted only
 * when its customer, subscription, org, month, quantity, rate, kind and claim UUID all match the stored
 * request. A listing that cannot be completed throws ReconcileIncompleteError — never "not found".
 */
async function findClaimItemAtStripe(stripe: StripeForOverage, claim: OverageClaim): Promise<{ id: string; invoice: string | null } | null> {
  if (!claim.stripeCustomerId) return null;
  if (!stripe.invoiceItems.list) throw new ReconcileIncompleteError(claim.id);
  const meta = claimMetadata(claim);
  let startingAfter: string | undefined;
  for (let page = 0; page < RECONCILE_PAGES_MAX; page++) {
    const res = await stripe.invoiceItems.list({ customer: claim.stripeCustomerId, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    for (const i of res.data) {
      const m = i.metadata ?? {};
      const customer = typeof i.customer === "string" ? i.customer : i.customer?.id ?? null;
      const subscription = typeof i.subscription === "string" ? i.subscription : i.subscription?.id ?? null;
      const expectedSubscription = claim.billedOnCustomer ? null : claim.stripeSubscriptionId;
      if (m.chub_claim !== meta.chub_claim || m.chub_kind !== meta.chub_kind || m.chub_org !== meta.chub_org || m.chub_month !== meta.chub_month) continue;
      if (m.chub_cents_per_minute !== meta.chub_cents_per_minute || Number(i.quantity) !== claim.minutes) continue;
      if (customer !== claim.stripeCustomerId || (subscription ?? null) !== expectedSubscription) continue;
      return { id: i.id, invoice: typeof i.invoice === "string" ? i.invoice : i.invoice?.id ?? null };
    }
    if (!res.has_more) return null;
    if (!res.data.length) throw new ReconcileIncompleteError(claim.id);
    startingAfter = res.data[res.data.length - 1].id;
  }
  throw new ReconcileIncompleteError(claim.id);
}

/** The record of a processor's outcome, fenced by its lease token: a stale processor's write changes nothing and is told so. */
class LeaseLostError extends Error {
  constructor(readonly claimId: number) { super(`lease lost: claim ${claimId}`); this.name = "LeaseLostError"; }
}

/**
 * Do one claim's Stripe work OUTSIDE the lock, with the claim's own parameters,
 * and record each step under the lock, fenced by the lease. Order: the attempt
 * is counted first (so a crash after the Stripe call is known to need
 * reconciliation); a claim ever sent before is reconciled against Stripe (its
 * UUID in the item's metadata, every page, fail closed) before anything is
 * created; the item is created under the claim's key; the item id is recorded
 * before the invoice step; a claim billed on the customer is then invoiced —
 * after a check that its item is not already on an invoice — and the claims
 * on that invoice are marked from the invoice's own lines. A failure leaves
 * the claim `failed` with the error (the lease released) and is thrown; the
 * next run retries this claim as it is.
 */
export async function processVoiceOverageClaim(claim: OverageClaim, deps: OverageDeps = {}): Promise<{ centsPerMinute: number; minutes: number; invoiceItemId: string; invoiceId: string | null; claimId: number }> {
  if (!overageBillingOn()) throw new Error("overage billing is off (CALL_ASSISTANT_OVERAGE_BILLING)");
  const stripe = stripeFor(deps);
  const fenced = async (set: string, values: unknown[], release: boolean) => {
    const { rows } = await lockFor(deps)(claim.accountUserId, () => pool.query(
      `UPDATE voice_overage_claims SET ${set}, ${release ? "leased_until = NULL, lease_token = NULL," : ""} updated_at = now() WHERE id = $1 AND lease_token = $2 RETURNING id`,
      [claim.id, claim.leaseToken, ...values]));
    if (!rows.length) throw new LeaseLostError(claim.id);
  };
  try {
    if (!claim.stripeCustomerId) throw new Error("claim has no customer");
    // Counted before the call: a crash after it leaves attempts > 0, which means "reconcile before creating".
    const sentBefore = claim.attempts > 0;
    await fenced("attempts = attempts + 1", [], false);
    let itemId = claim.stripeInvoiceItemId;
    let invoiceId = claim.stripeInvoiceId;
    if (!itemId) {
      const found = sentBefore ? await findClaimItemAtStripe(stripe, claim) : null;
      if (found) { itemId = found.id; invoiceId = invoiceId ?? found.invoice; }
      else {
        const price = await resolveOveragePriceId(stripe, claim.centsPerMinute);
        const item = await stripe.invoiceItems.create(
          {
            customer: claim.stripeCustomerId,
            // Queued: ride the origin subscription's next invoice. Otherwise left unattached and invoiced now (below).
            ...(claim.billedOnCustomer || !claim.stripeSubscriptionId ? {} : { subscription: claim.stripeSubscriptionId }),
            pricing: { price },
            quantity: claim.minutes,
            description: claimDescription(claim),
            metadata: claimMetadata(claim),
          },
          { idempotencyKey: claim.idempotencyKey },
        );
        itemId = item.id;
      }
      // Recorded before the invoice step: a crash after this never creates the item again.
      await fenced(`stripe_invoice_item_id = $3, state = CASE WHEN $4::text IS NULL THEN 'queued' ELSE 'invoiced' END, stripe_invoice_id = COALESCE($4::text, stripe_invoice_id), error = NULL`, [itemId, invoiceId], false);
    } else if (claim.billedOnCustomer && !invoiceId && stripe.invoiceItems.retrieve) {
      // The item is known but no invoice is: it may already sit on one (an earlier invoice that included it).
      const item = await stripe.invoiceItems.retrieve(itemId);
      const on = typeof item.invoice === "string" ? item.invoice : item.invoice?.id ?? null;
      if (on) { invoiceId = on; await fenced("state = 'invoiced', stripe_invoice_id = $3, error = NULL", [on], false); }
    }
    if (claim.billedOnCustomer && !invoiceId) {
      const invoice = await stripe.invoices.create(
        {
          customer: claim.stripeCustomerId,
          pending_invoice_items_behavior: "include",
          collection_method: "charge_automatically",
          auto_advance: true,
          description: claimDescription(claim),
          metadata: { chub_kind: "voice_overage", chub_org: claim.orgId, chub_month: claim.month, chub_claim: claim.uid },
        },
        { idempotencyKey: `${claim.idempotencyKey}-invoice` },
      );
      invoiceId = invoice.id;
      // Only the claims whose items the invoice's own lines carry are marked — this one among them.
      await lockFor(deps)(claim.accountUserId, () => markInvoicedFromStripe(stripe, claim.accountUserId, invoiceId!));
    }
    await fenced("error = NULL", [], true);
    await pool.query("UPDATE voice_usage SET stripe_usage_record_id = $3 WHERE org_id = $1 AND month = $2", [claim.orgId, claim.month, itemId]).catch(() => {});
    return { centsPerMinute: claim.centsPerMinute, minutes: claim.minutes, invoiceItemId: itemId, invoiceId, claimId: claim.id };
  } catch (e: any) {
    if (!(e instanceof LeaseLostError)) {
      const reason = e instanceof ReconcileIncompleteError ? "reconcile_incomplete" : String(e?.message || e).slice(0, 500);
      // A claim whose listing could not be completed is `creating` (nothing is known; reconciled next time); any other failure is `failed`.
      await fenced(e instanceof ReconcileIncompleteError ? "state = 'creating', error = $3" : "state = 'failed', error = $3", [reason], true).catch(() => {});
    }
    throw e;
  }
}

/**
 * Mark invoiced exactly the account's claims whose items the invoice carries,
 * read from the invoice's own lines at Stripe (every page) — never "every
 * queued claim on the account".
 */
async function markInvoicedFromStripe(stripe: StripeForOverage, accountUserId: number, invoiceId: string): Promise<string[]> {
  const itemIds: string[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < RECONCILE_PAGES_MAX; page++) {
    const res = await stripe.invoices.listLineItems(invoiceId, { limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    for (const line of res.data) {
      const id = typeof line.invoice_item === "string" ? line.invoice_item : line.invoice_item?.id ?? null;
      if (id) itemIds.push(id);
    }
    if (!res.has_more || !res.data.length) break;
    startingAfter = res.data[res.data.length - 1].id;
  }
  if (itemIds.length) {
    await pool.query(
      `UPDATE voice_overage_claims SET state = 'invoiced', stripe_invoice_id = $3, error = NULL, updated_at = now()
        WHERE account_user_id = $1 AND stripe_invoice_item_id = ANY($2::text[]) AND state <> 'invoiced'`,
      [accountUserId, itemIds, invoiceId]);
  }
  return itemIds;
}

/**
 * Bill the month's not-yet-claimed overage minutes: claim under the lock
 * (claimVoiceOverage), then each claim's Stripe work outside it
 * (processVoiceOverageClaim), earlier unfinished claims first. Safe to call
 * repeatedly (nothing new → nothing sent); the sweep below runs it for every
 * finished month on the 1st and after. Without the switch, Stripe, or a
 * customer to bill, it reports nothing and says why — the minutes stay on
 * the row for a later run.
 */
export async function reportVoiceOverage(orgId: string, month: string, deps: OverageDeps = {}): Promise<OverageReport> {
  const { claims, reason } = await claimVoiceOverage(orgId, month, deps);
  if (!claims.length) return { reported: 0, reason: reason ?? "nothing_to_report" };
  const lines: { centsPerMinute: number; minutes: number; invoiceItemId: string; invoiceId: string | null; claimId: number }[] = [];
  // Claim by claim, each recorded before the next is touched: a failure on a later claim leaves the earlier
  // ones recorded, so a retry re-sends only what was not billed.
  for (const claim of claims) lines.push(await processVoiceOverageClaim(claim, deps));
  const reported = lines.reduce((n, l) => n + l.minutes, 0);
  const reportedCents = lines.reduce((n, l) => n + l.minutes * l.centsPerMinute, 0);
  const invoiceId = lines.find((l) => l.invoiceId)?.invoiceId ?? null;
  return { reported, reportedCents, lines, invoiceItemId: lines[0].invoiceItemId, invoiceId };
}

// ── Settlement: persisted work when a subscription ends ────────────────────

export type VoiceSettleJob = {
  id: number; accountUserId: number; stripeSubscriptionId: string; stripeCustomerId: string | null; billingInterval: string | null;
  state: "pending" | "done" | "failed"; attempts: number; error: string | null; leaseToken: string | null;
};
const jobFrom = (r: any): VoiceSettleJob => ({
  id: Number(r.id), accountUserId: Number(r.account_user_id), stripeSubscriptionId: r.stripe_subscription_id, stripeCustomerId: r.stripe_customer_id ?? null,
  billingInterval: r.billing_interval ?? null, state: r.state, attempts: Number(r.attempts ?? 0), error: r.error ?? null, leaseToken: r.lease_token ?? null,
});

/**
 * Persist the settlement a subscription's end owes, on the given connection
 * (server/voice/subscription.ts inserts it in the SAME transaction that records
 * the cancellation, so no end is ever recorded without its settlement job).
 * Jobs are append-only: one open (pending / failed) job per subscription at a
 * time; a done job is never reopened — new outstanding work gets a new job.
 */
export async function enqueueVoiceSettlement(c: Queryable, job: { accountUserId: number; stripeSubscriptionId: string; stripeCustomerId: string | null; billingInterval: string | null }): Promise<void> {
  await c.query(
    `INSERT INTO voice_settle_jobs (account_user_id, stripe_subscription_id, stripe_customer_id, billing_interval, state)
     SELECT $1, $2, $3, $4, 'pending'
      WHERE NOT EXISTS (SELECT 1 FROM voice_settle_jobs WHERE stripe_subscription_id = $2 AND state IN ('pending', 'failed'))`,
    [job.accountUserId, job.stripeSubscriptionId, job.stripeCustomerId, job.billingInterval]);
}

/** The jobs still to run: pending, and failed ones (retried by every sweep). */
export async function listPendingVoiceSettlements(accountUserId?: number): Promise<VoiceSettleJob[]> {
  await voiceOverageClaimsReady();
  const { rows } = accountUserId === undefined
    ? await pool.query("SELECT * FROM voice_settle_jobs WHERE state IN ('pending', 'failed') ORDER BY id")
    : await pool.query("SELECT * FROM voice_settle_jobs WHERE state IN ('pending', 'failed') AND account_user_id = $1 ORDER BY id", [accountUserId]);
  return rows.map(jobFrom);
}

export type VoiceSettlement = {
  jobId: number; claimed: number; reportedMinutes: number; reportedCents: number; queuedInvoiced: number; invoiceId: string | null;
  /** done: every claim of the subscription verified invoiced and nothing outstanding; pending: work remains (retried); skipped: the lease is held elsewhere, or the switch is off. */
  outcome: "done" | "pending" | "skipped";
};

/**
 * Run one settlement — for ITS subscription only: under the lock, take the
 * job's lease atomically (a webhook and a sweep never run one job together);
 * claim every outstanding month whose latest usage was under that
 * subscription as billed-on-customer claims with the job's customer and
 * interval; turn the subscription's own unfinished claims into
 * billed-on-customer ones (their origin stays; an ended subscription takes no
 * items); outside the lock, each claim's Stripe work; then one invoice on
 * the kept customer for the subscription's claims still queued for its
 * invoice that will never come, marked from the invoice's lines; then the job
 * is done only when every claim of the subscription is verified invoiced and
 * no month is outstanding — otherwise it stays pending for the next sweep.
 * Every write is fenced by the lease token. A failure marks the job failed
 * with its error, records an ops issue and is thrown; it is never swallowed.
 * With the switch off the job is left as it is (recorded, not executed).
 */
export async function runVoiceSettlement(job: VoiceSettleJob, deps: OverageDeps = {}): Promise<VoiceSettlement> {
  const skipped = (): VoiceSettlement => ({ jobId: job.id, claimed: 0, reportedMinutes: 0, reportedCents: 0, queuedInvoiced: 0, invoiceId: null, outcome: "skipped" });
  if (!overageBillingOn()) return skipped();
  const lock = lockFor(deps);
  // The lease: one processor per job, atomically.
  const { rows: [leased] } = await pool.query(
    `UPDATE voice_settle_jobs SET leased_until = now() + ($2::int * interval '1 minute'), lease_token = gen_random_uuid(), attempts = attempts + 1, updated_at = now()
      WHERE id = $1 AND state IN ('pending', 'failed') AND (leased_until IS NULL OR leased_until < now()) RETURNING *`, [job.id, LEASE_MINUTES]);
  if (!leased) return skipped();
  const token = String(leased.lease_token);
  const fenced = (set: string, values: unknown[] = []) => pool.query(
    `UPDATE voice_settle_jobs SET ${set}, leased_until = NULL, lease_token = NULL, updated_at = now() WHERE id = $1 AND lease_token = $2`, [job.id, token, ...values]);
  try {
    if (!configuredFor(deps)) throw new Error("Stripe is not configured");
    const ended: OverageSubscription = { stripeCustomerId: job.stripeCustomerId, stripeSubscriptionId: job.stripeSubscriptionId, status: "canceled", billingInterval: job.billingInterval };
    // 1. Claims for every outstanding month of this subscription (its usage rows), billed on the job's customer.
    const { rows: months } = await pool.query(
      "SELECT org_id, month FROM voice_usage WHERE account_user_id = $1 AND stripe_subscription_id = $2 AND overage_minutes > overage_reported_minutes ORDER BY month, org_id",
      [job.accountUserId, job.stripeSubscriptionId]);
    const claims: OverageClaim[] = [];
    for (const m of months) {
      const { claims: c } = await claimVoiceOverage(m.org_id, m.month, { ...deps, subscriptionFor: async () => ended });
      claims.push(...c);
    }
    // 2. This subscription's own unfinished claims, re-aimed at the customer (origin kept): nothing queued for it can be billed through it any more.
    const retargeted = await lock(job.accountUserId, async () => {
      const { rows } = await pool.query(
        `UPDATE voice_overage_claims SET billed_on_customer = true, invoice_now = true, updated_at = now()
          WHERE account_user_id = $1 AND stripe_subscription_id = $2 AND stripe_invoice_item_id IS NULL AND state IN ('creating', 'pending', 'failed')
            AND (leased_until IS NULL OR leased_until < now()) RETURNING id`, [job.accountUserId, job.stripeSubscriptionId]);
      return leaseClaims(rows.map((r) => Number(r.id)));
    });
    for (const c of retargeted) if (!claims.some((k) => k.id === c.id)) claims.push(c);
    let reportedMinutes = 0, reportedCents = 0, invoiceId: string | null = null;
    for (const claim of claims) {
      const line = await processVoiceOverageClaim({ ...claim, billedOnCustomer: true, stripeCustomerId: claim.stripeCustomerId ?? job.stripeCustomerId }, deps);
      reportedMinutes += line.minutes; reportedCents += line.minutes * line.centsPerMinute; invoiceId = line.invoiceId ?? invoiceId;
    }
    // 3. Whatever of this subscription's is still queued (an item on its next invoice) is invoiced now on the customer.
    const queued = await invoiceQueuedVoiceOverage(job.accountUserId, job.stripeSubscriptionId, { ...deps, subscriptionFor: async () => ended });
    // 4. Done only when every claim of the subscription is verified invoiced and no month of it is outstanding.
    const { rows: [left] } = await pool.query(
      `SELECT (SELECT count(*) FROM voice_overage_claims WHERE account_user_id = $1 AND stripe_subscription_id = $2 AND state <> 'invoiced')::int AS claims,
              (SELECT count(*) FROM voice_usage WHERE account_user_id = $1 AND stripe_subscription_id = $2 AND overage_minutes > overage_reported_minutes)::int AS months`,
      [job.accountUserId, job.stripeSubscriptionId]);
    const outstanding = Number(left?.claims ?? 0) + Number(left?.months ?? 0);
    if (outstanding) await fenced("state = 'pending', error = $3", [`work outstanding: ${left.claims} claim(s), ${left.months} month(s)`]);
    else await fenced("state = 'done', error = NULL, done_at = now()");
    return { jobId: job.id, claimed: claims.length, reportedMinutes, reportedCents, queuedInvoiced: queued.claims, invoiceId: queued.invoiceId ?? invoiceId, outcome: outstanding ? "pending" : "done" };
  } catch (e: any) {
    await fenced("state = 'failed', error = $3", [String(e?.message || e).slice(0, 500)]).catch(() => {});
    console.error(`[voice-usage] settlement ${job.id} (user ${job.accountUserId}, ${job.stripeSubscriptionId}) failed (the sweep retries):`, e?.message || e);
    void recordFailure("call_assistant", "Call Assistant overage settlement at cancellation", e, { jobId: job.id, userId: job.accountUserId, subscriptionId: job.stripeSubscriptionId }, "critical");
    throw e;
  }
}

/** Run the account's pending settlements (called right after its subscription's end is recorded). A failure is recorded on the job and thrown. With the switch off nothing runs. */
export async function runVoiceSettlementsForAccount(accountUserId: number, deps: OverageDeps = {}): Promise<VoiceSettlement[]> {
  if (!overageBillingOn()) return [];
  const out: VoiceSettlement[] = [];
  for (const job of await listPendingVoiceSettlements(accountUserId)) out.push(await runVoiceSettlement(job, deps));
  return out;
}

/**
 * Invoice now the given subscription's claims whose items are still queued
 * for its invoice that will never come (it ended): one invoice on the kept
 * customer takes the customer's pending items; the claims marked are those
 * the invoice's own lines carry. Nothing queued → nothing sent. The Stripe
 * call is outside the lock; the record under it.
 */
export async function invoiceQueuedVoiceOverage(accountUserId: number, subscriptionId: string, deps: OverageDeps = {}): Promise<{ claims: number; invoiceId: string | null }> {
  await voiceOverageClaimsReady();
  if (!overageBillingOn()) return { claims: 0, invoiceId: null };
  const { rows } = await pool.query(
    "SELECT * FROM voice_overage_claims WHERE account_user_id = $1 AND stripe_subscription_id = $2 AND state = 'queued' AND stripe_invoice_item_id IS NOT NULL ORDER BY id", [accountUserId, subscriptionId]);
  const queued = rows.map(claimFrom);
  if (!queued.length) return { claims: 0, invoiceId: null };
  if (!configuredFor(deps)) return { claims: 0, invoiceId: null };
  const customer = queued.find((c) => c.stripeCustomerId)?.stripeCustomerId ?? (await (deps.subscriptionFor ?? defaultSubscriptionFor)(accountUserId))?.stripeCustomerId;
  if (!customer) return { claims: 0, invoiceId: null };
  const stripe = stripeFor(deps);
  const last = queued[queued.length - 1];
  const invoice = await stripe.invoices.create(
    {
      customer,
      pending_invoice_items_behavior: "include",
      collection_method: "charge_automatically",
      auto_advance: true,
      description: `${CALL_ASSISTANT_NAME}: minutes over the included minutes, billed at the end of the subscription`,
      metadata: { chub_kind: "voice_overage", chub_account: String(accountUserId), chub_subscription: subscriptionId, chub_claims: queued.map((c) => c.uid).join(",") },
    },
    // The newest queued claim names the batch: the same batch retried gets the same invoice.
    { idempotencyKey: `chub-voice-overage-queued-${subscriptionId}-${last.id}` },
  );
  const marked = await lockFor(deps)(accountUserId, () => markInvoicedFromStripe(stripe, accountUserId, invoice.id));
  return { claims: queued.filter((c) => marked.includes(c.stripeInvoiceItemId!)).length, invoiceId: invoice.id };
}

/** "YYYY-MM" of the month before `now` (UTC). */
export const previousVoiceMonth = (now = new Date()) => voiceMonthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));

export type OverageSweep = {
  /** The latest month swept (the requested one, or last month). */
  month: string;
  /** Every month that had something outstanding, oldest first. */
  months: string[];
  /** (org, month) pairs that billed something. */
  orgs: number;
  reportedMinutes: number;
  reportedCents: number;
  skipped: Record<string, number>;
};

/** Bill each (org, month) in turn; one failure never stops the others. */
async function reportEach(rows: { org_id: string; month: string }[], deps: OverageDeps): Promise<Omit<OverageSweep, "month">> {
  let orgs = 0, reportedMinutes = 0, reportedCents = 0;
  const skipped: Record<string, number> = {};
  const months = new Set<string>();
  for (const r of rows) {
    months.add(r.month);
    try {
      const out = await reportVoiceOverage(r.org_id, r.month, deps);
      if (out.reported > 0 && "reportedCents" in out) { orgs += 1; reportedMinutes += out.reported; reportedCents += out.reportedCents; }
      else if ("reason" in out) skipped[out.reason] = (skipped[out.reason] ?? 0) + 1;
    } catch (e: any) {
      skipped.error = (skipped.error ?? 0) + 1;
      console.error(`[voice-usage] overage report failed for org ${r.org_id} ${r.month}:`, e?.message || e);
      void recordFailure("job", "Call Assistant overage billing (one org)", e, { orgId: r.org_id, month: r.month });
    }
  }
  return { months: [...months].sort(), orgs, reportedMinutes, reportedCents, skipped };
}

/**
 * Every org with unclaimed overage: for `month` when one is given, otherwise
 * for EVERY finished month (older than the current one) that still has some —
 * a month skipped on the 1st (Stripe down, a subscription that had just ended)
 * is picked up by any later sweep, never left behind. The current month is
 * left to accrue; ending a subscription settles it (runVoiceSettlement).
 */
export async function reportAllVoiceOverage(month?: string, deps: OverageDeps = {}): Promise<OverageSweep> {
  const { rows } = month
    ? await pool.query("SELECT org_id, month FROM voice_usage WHERE month = $1 AND overage_minutes > overage_reported_minutes ORDER BY org_id", [month])
    : await pool.query("SELECT org_id, month FROM voice_usage WHERE month < $1 AND overage_minutes > overage_reported_minutes ORDER BY month, org_id", [voiceMonthKey()]);
  const out = await reportEach(rows, deps);
  return { month: month ?? previousVoiceMonth(), ...out };
}

export type VoiceOverageSweepResult = {
  billing: OverageBillingState;
  months: OverageSweep;
  /** Earlier claims left unfinished (a crash, a Stripe outage): reconciled or retried. */
  claimsRetried: number; claimsFailed: number;
  /** Settlement jobs run (pending and failed ones), how many are done, how many failed again. */
  settlementsRun: number; settlementsDone: number; settlementsFailed: number;
  /** Queued claims found on ended subscriptions with no open job: a job was made for each such subscription. */
  settlementsQueued: number;
};

/**
 * The whole sweep (the worker, every six hours): every finished month's
 * unclaimed overage; every claim left unfinished anywhere; a settlement job
 * for any queued claim whose subscription has ended without an open job (the
 * safety net); then every pending or failed settlement job. Each part's
 * failures are recorded and never stop the others. With the switch off it
 * does nothing and says so.
 */
export async function sweepVoiceOverage(deps: OverageDeps = {}): Promise<VoiceOverageSweepResult> {
  await voiceOverageClaimsReady();
  const billing = voiceOverageBillingState();
  const none: VoiceOverageSweepResult = { billing, months: { month: previousVoiceMonth(), months: [], orgs: 0, reportedMinutes: 0, reportedCents: 0, skipped: {} }, claimsRetried: 0, claimsFailed: 0, settlementsRun: 0, settlementsDone: 0, settlementsFailed: 0, settlementsQueued: 0 };
  if (billing !== "on") return none;
  const months = await reportAllVoiceOverage(undefined, deps);
  let claimsRetried = 0, claimsFailed = 0;
  const { rows: unfinishedRows } = await pool.query("SELECT id, account_user_id FROM voice_overage_claims WHERE state IN ('creating', 'pending', 'failed') AND (leased_until IS NULL OR leased_until < now()) ORDER BY id");
  for (const r of unfinishedRows) {
    const [claim] = await lockFor(deps)(Number(r.account_user_id), () => leaseClaims([Number(r.id)]));
    if (!claim) continue;
    try { await processVoiceOverageClaim(claim, deps); claimsRetried++; }
    catch (e: any) { claimsFailed++; void recordFailure("job", "Call Assistant overage claim retry", e, { claimId: claim.id, orgId: claim.orgId, month: claim.month }); }
  }
  const { rows: orphaned } = await pool.query(
    `INSERT INTO voice_settle_jobs (account_user_id, stripe_subscription_id, stripe_customer_id, billing_interval, state)
     SELECT DISTINCT c.account_user_id, c.stripe_subscription_id, c.stripe_customer_id, c.billing_interval, 'pending'
       FROM voice_overage_claims c LEFT JOIN call_assistant_subscriptions s ON s.stripe_subscription_id = c.stripe_subscription_id
      WHERE c.state = 'queued' AND c.stripe_subscription_id IS NOT NULL AND (s.status IS NULL OR NOT (s.status = ANY($1::text[])))
        AND NOT EXISTS (SELECT 1 FROM voice_settle_jobs j WHERE j.stripe_subscription_id = c.stripe_subscription_id AND j.state IN ('pending', 'failed'))
     RETURNING id`, [[...LIVE_STATUSES]]);
  let settlementsRun = 0, settlementsDone = 0, settlementsFailed = 0;
  for (const job of await listPendingVoiceSettlements()) {
    settlementsRun++;
    try { if ((await runVoiceSettlement(job, deps)).outcome === "done") settlementsDone++; } catch { settlementsFailed++; }
  }
  return { billing, months, claimsRetried, claimsFailed, settlementsRun, settlementsDone, settlementsFailed, settlementsQueued: orphaned.length };
}

/** What the platform admin sees: the switch, the constraints in place, the work still open (counts only). */
export async function voiceOverageAdminStatus() {
  await voiceOverageClaimsReady();
  const { rows: [c] } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS gist,
            EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voice_overage_claims_no_overlap') AS no_overlap,
            EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voice_overage_claims_range_check') AS range_check`);
  const { rows: [w] } = await pool.query(
    `SELECT (SELECT count(*) FROM voice_overage_claims WHERE state IN ('creating', 'pending', 'failed'))::int AS unfinished_claims,
            (SELECT count(*) FROM voice_overage_claims WHERE state = 'queued')::int AS queued_claims,
            (SELECT count(*) FROM voice_settle_jobs WHERE state = 'pending')::int AS pending_settlements,
            (SELECT count(*) FROM voice_settle_jobs WHERE state = 'failed')::int AS failed_settlements,
            (SELECT count(*) FROM voice_call_meter WHERE state = 'pending')::int AS pending_meters`);
  return {
    overageBilling: voiceOverageBillingState(),
    constraints: { btreeGist: Boolean(c?.gist), overlapExclusion: Boolean(c?.no_overlap), rangeCheck: Boolean(c?.range_check) },
    work: { unfinishedClaims: Number(w?.unfinished_claims ?? 0), queuedClaims: Number(w?.queued_claims ?? 0), pendingSettlements: Number(w?.pending_settlements ?? 0), failedSettlements: Number(w?.failed_settlements ?? 0), pendingMeters: Number(w?.pending_meters ?? 0) },
  };
}

// ── The sweep worker (started from registerVoiceRoutes in server/voice/index.ts) ──

const SWEEP_EVERY_MS = 6 * 60 * 60_000;
const SWEEP_FIRST_DELAY_MS = 10 * 60_000;
let sweepStarted = false;

/** Why the overage sweep is off, or null when it runs (production + Stripe + the explicit switch). */
/**
 * Why the overage sweep is off, or null when it runs: the safety switch on (CALL_ASSISTANT_OVERAGE_BILLING=on)
 * and Stripe configured are all it takes — turning the switch on and restarting starts the backlog sweep;
 * VOICE_OVERAGE_WORKER_ENABLED=false is only an explicit kill switch (default on).
 */
export function voiceOverageWorkerOffReason(env: NodeJS.ProcessEnv = process.env): string | null {
  if (voiceOverageBillingState(env) !== "on") return "CALL_ASSISTANT_OVERAGE_BILLING is not on (minutes are metered, nothing is charged)";
  if (env.VOICE_OVERAGE_WORKER_ENABLED === "false") return "VOICE_OVERAGE_WORKER_ENABLED=false (the kill switch)";
  if (!env.STRIPE_SECRET_KEY) return "STRIPE_SECRET_KEY is not set";
  return null;
}

/**
 * Every 6 hours, the whole sweep (sweepVoiceOverage): every finished month's
 * unclaimed overage, every claim left unfinished, every settlement still owed
 * (idempotent, so the repeats are no-ops once done; a Stripe outage on the 1st
 * is retried on the next run, and nothing is ever left behind). Off in tests
 * and anywhere the switch is off.
 */
export function startVoiceOverageWorker(): void {
  if (sweepStarted || process.env.NODE_ENV === "test" || process.env.VITEST) return;
  sweepStarted = true;
  // One boot line with the safety switch's state (CALL_ASSISTANT_OVERAGE_BILLING, default off).
  console.log(`[voice-usage] Call Assistant overage billing: ${voiceOverageBillingState()}${voiceOverageBillingState() === "on" ? ` (Stripe items and invoices are created for minutes above the tier; the backlog sweep starts in ${SWEEP_FIRST_DELAY_MS / 60_000} minutes, then every ${SWEEP_EVERY_MS / 3_600_000} hours)` : " (minutes above the tier are metered and shown, never charged; settlement jobs are recorded, not run — no claim or Stripe item is created while off)"}.`);
  const off = voiceOverageWorkerOffReason();
  if (off) {
    console.log(`[voice-usage] the overage sweep is off: ${off}.`);
    return;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const out = await sweepVoiceOverage();
      const m = out.months;
      if (m.orgs || Object.keys(m.skipped).length || out.claimsRetried || out.claimsFailed || out.settlementsRun || out.settlementsQueued) {
        console.log(`[voice-usage] overage ${m.months.join(",") || m.month}: billed ${m.reportedMinutes} min ($${(m.reportedCents / 100).toFixed(2)}) for ${m.orgs} org-month(s); skipped ${JSON.stringify(m.skipped)}; claims retried ${out.claimsRetried} (failed ${out.claimsFailed}); settlements run ${out.settlementsRun} (failed ${out.settlementsFailed}, queued ${out.settlementsQueued})`);
      }
    } catch (e: any) {
      console.error("[voice-usage] overage sweep failed:", e?.message || e);
      void recordFailure("job", "Call Assistant overage billing sweep", e);
    } finally { running = false; }
  };
  setTimeout(run, SWEEP_FIRST_DELAY_MS).unref();
  setInterval(run, SWEEP_EVERY_MS).unref();
}
