/**
 * The AI Call Assistant's own subscription row — the service is sold apart
 * from the platform plans (owner, 2026-10-08), the way the CRM is
 * (server/crm/entitlements.ts): one row per account in
 * `call_assistant_subscriptions`, never in `subscriptions`. Every platform
 * billing path reads `subscriptions` by user or by Stripe customer and assumes
 * one row, so the service's subscription must not live there; both products
 * share the account's Stripe customer, and the Call Assistant's Stripe
 * subscription carries metadata.product = "call_assistant" and is made of the
 * Call Assistant's own prices (server/billing/prices.ts), which is how the
 * webhook tells it apart (server/voice/subscription.ts).
 *
 * This module is the table and its readers only — no Stripe, no routes — so
 * server/entitlements.ts and server/voice/number-release.ts can read the row
 * without pulling the billing routes in.
 */
import { pool } from "../db";
import {
  callAssistantAddonsOf, callAssistantTierKey,
  type AddonKey, type BillingInterval, type CallAssistantTierKey,
} from "@shared/plans";

/** Idempotent, additive. Run once per process before anything reads the table (also listed in scripts/apply-schema-migration.ts). */
export const CALL_ASSISTANT_SUBSCRIPTION_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS call_assistant_subscriptions (
     id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
     user_id integer NOT NULL UNIQUE,
     stripe_customer_id text,
     stripe_subscription_id text,
     stripe_price_id text,
     tier text,
     extra_numbers integer NOT NULL DEFAULT 0,
     status text NOT NULL DEFAULT 'inactive',
     billing_interval text,
     current_period_end timestamp,
     cancel_at_period_end boolean,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS call_assistant_subscriptions_stripe_sub_idx ON call_assistant_subscriptions (stripe_subscription_id)`,
  // One checkout or tier change in flight per account, across processes (Codex audit #4): the attempt
  // row IS the lock. It is inserted under the account's database lock with its Stripe idempotency key
  // (one in-flight row per account, the partial unique index); the Stripe call runs outside the lock
  // with that key; completion writes are conditional on the attempt's id and state; a competing request
  // finds the row and resumes the same session or is told to wait (server/voice/subscription.ts).
  `CREATE TABLE IF NOT EXISTS call_assistant_checkout_attempts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id integer NOT NULL,
     kind text NOT NULL,
     state text NOT NULL DEFAULT 'creating',
     order_key text,
     stripe_customer_id text,
     stripe_subscription_id text,
     idempotency_key text NOT NULL,
     session_id text,
     session_url text,
     error text,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now(),
     finished_at timestamp
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS call_assistant_checkout_attempts_in_flight_idx ON call_assistant_checkout_attempts (user_id) WHERE state IN ('creating', 'open')`,
  `CREATE INDEX IF NOT EXISTS call_assistant_checkout_attempts_user_idx ON call_assistant_checkout_attempts (user_id, created_at)`,
  // A second live subscription the webhook saw for an account that has one: one row per duplicate,
  // completed by its own id (never a single slot that a newer duplicate could overwrite). Ours →
  // pending until cancelled at Stripe (the webhook, then the retry job); not ours → skipped, noted.
  `CREATE TABLE IF NOT EXISTS call_assistant_duplicate_cancellations (
     id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
     user_id integer NOT NULL,
     tracked_subscription_id text,
     duplicate_subscription_id text NOT NULL UNIQUE,
     ours boolean NOT NULL DEFAULT false,
     state text NOT NULL DEFAULT 'pending',
     attempts integer NOT NULL DEFAULT 0,
     error text,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now(),
     done_at timestamp
   )`,
  `CREATE INDEX IF NOT EXISTS call_assistant_duplicate_cancellations_state_idx ON call_assistant_duplicate_cancellations (state)`,
];

let schemaReady: Promise<void> | null = null;
/**
 * The tables exist before the first read. A failure is logged, the caller gets the error (nothing runs on a
 * half-made schema; the boot logs it loudly), and the next call tries again.
 */
export function callAssistantSchemaReady(): Promise<void> {
  schemaReady ??= (async () => {
    for (const ddl of CALL_ASSISTANT_SUBSCRIPTION_DDL) await pool.query(ddl);
  })().catch((e: any) => {
    console.error("[call-assistant-billing] could not create the Call Assistant billing tables:", e?.message || e);
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

export type CallAssistantSubscriptionRow = {
  id: number;
  user_id: number;
  /**
   * The Stripe customer and subscription. Both STAY on the row after the subscription
   * ends (status canceled, tier null): overage minutes recorded under it are billed to
   * that customer afterwards (server/voice/billing-usage.ts reportVoiceOverage).
   */
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  /** A CallAssistantTierKey while the subscription holds a tier; null once it ended. */
  tier: string | null;
  extra_numbers: number;
  status: string;
  billing_interval: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean | null;
};

/** One checkout or tier change in flight for an account (call_assistant_checkout_attempts). */
export type CallAssistantAttemptRow = {
  id: string;
  user_id: number;
  kind: "checkout" | "change";
  state: "creating" | "open" | "done" | "failed" | "expired";
  order_key: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  idempotency_key: string;
  session_id: string | null;
  session_url: string | null;
  error: string | null;
  created_at?: Date | string | null;
};

/** The account's Call Assistant subscription row, or undefined. */
export async function callAssistantSubscriptionRow(userId: number): Promise<CallAssistantSubscriptionRow | undefined> {
  await callAssistantSchemaReady();
  const { rows: [row] } = await pool.query(`SELECT * FROM call_assistant_subscriptions WHERE user_id = $1 LIMIT 1`, [userId]);
  return row;
}

/**
 * The columns server/entitlements.ts accountSubscriptionRow joins in beside the
 * platform row (alias `c`), each prefixed call_assistant_, so one query answers
 * both products; callAssistantSubscriptionOf reads them back.
 */
export const CALL_ASSISTANT_JOIN_COLUMNS =
  "c.tier AS call_assistant_tier, c.status AS call_assistant_status, c.extra_numbers AS call_assistant_extra_numbers, " +
  "c.billing_interval AS call_assistant_interval, c.current_period_end AS call_assistant_period_end, " +
  "c.cancel_at_period_end AS call_assistant_cancel_at_period_end, c.stripe_subscription_id AS call_assistant_subscription_id";

export type CallAssistantJoinedColumns = {
  call_assistant_tier?: string | null;
  call_assistant_status?: string | null;
  call_assistant_extra_numbers?: number | string | null;
  call_assistant_interval?: string | null;
  call_assistant_period_end?: Date | string | null;
  call_assistant_cancel_at_period_end?: boolean | null;
  call_assistant_subscription_id?: string | null;
};

/** What the account's Call Assistant subscription says, as the entitlements and the number-release decision read it. */
export type CallAssistantSubscriptionState = {
  /** The Stripe status, or null without a subscription row. */
  status: string | null;
  /** The held tier, whatever the status (null once the subscription ended or never held one). */
  tier: CallAssistantTierKey | null;
  extraNumbers: number;
  /** The tier and extra numbers as the quantities map every voice code path reads ({ call_assistant: 1, call_number: 2 }). */
  addons: Partial<Record<AddonKey, number>>;
  interval: BillingInterval | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean | null;
  stripeSubscriptionId: string | null;
};

export const NO_CALL_ASSISTANT: CallAssistantSubscriptionState = {
  status: null, tier: null, extraNumbers: 0, addons: {}, interval: null, currentPeriodEnd: null, cancelAtPeriodEnd: null, stripeSubscriptionId: null,
};

/** The subscription state out of the joined columns (or a bare row's own columns). Null columns = no subscription. */
export function callAssistantSubscriptionOf(row: CallAssistantJoinedColumns | null | undefined): CallAssistantSubscriptionState {
  if (!row || !row.call_assistant_status) return NO_CALL_ASSISTANT;
  const tier = callAssistantTierKey(row.call_assistant_tier);
  const extraNumbers = Math.max(0, Math.floor(Number(row.call_assistant_extra_numbers) || 0));
  const interval = row.call_assistant_interval === "month" || row.call_assistant_interval === "year" ? row.call_assistant_interval : null;
  return {
    status: row.call_assistant_status,
    tier,
    extraNumbers,
    addons: callAssistantAddonsOf(tier, extraNumbers),
    interval,
    currentPeriodEnd: row.call_assistant_period_end ? new Date(row.call_assistant_period_end) : null,
    cancelAtPeriodEnd: typeof row.call_assistant_cancel_at_period_end === "boolean" ? row.call_assistant_cancel_at_period_end : null,
    stripeSubscriptionId: row.call_assistant_subscription_id ?? null,
  };
}

/** A bare call_assistant_subscriptions row as the joined-column shape (the billing routes read the row directly). */
export function joinedColumnsOf(row: CallAssistantSubscriptionRow | null | undefined): CallAssistantJoinedColumns | null {
  if (!row) return null;
  return {
    call_assistant_tier: row.tier, call_assistant_status: row.status, call_assistant_extra_numbers: row.extra_numbers,
    call_assistant_interval: row.billing_interval, call_assistant_period_end: row.current_period_end,
    call_assistant_cancel_at_period_end: row.cancel_at_period_end, call_assistant_subscription_id: row.stripe_subscription_id,
  };
}
