/**
 * The à la carte subscriptions table — one row per account and item
 * (shared/alacarte.ts), each its own Stripe subscription, never in
 * `subscriptions` (every platform billing path reads that table by user or
 * by Stripe customer and assumes one row — the CRM's and the Call Assistant's
 * reasoning, server/crm/entitlements.ts, server/voice/subscription-store.ts).
 * An à la carte Stripe subscription carries metadata.product = "alacarte" and
 * is made of à la carte prices (server/billing/prices.ts alacartePriceSpec),
 * which is how the webhook tells it apart (server/billing/alacarte.ts).
 *
 * This module is the table and its readers only — no Stripe, no routes — so
 * server/entitlements.ts and server/crm/entitlements.ts can read the rows
 * without pulling the billing routes in.
 */
import { pool } from "../db";
import { ACCESS_STATUSES, PAYMENT_NEEDED_STATUSES, type BillingInterval } from "@shared/plans";
import { isAlacarteKey, isAlacarteTier, type AlacarteHolding, type AlacarteKey, type AlacarteTier } from "@shared/alacarte";

/** Idempotent, additive. Run once per process before anything reads the table (also listed in scripts/apply-schema-migration.ts). */
export const ALACARTE_SUBSCRIPTION_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS alacarte_subscriptions (
     id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
     user_id integer NOT NULL,
     item_key text NOT NULL,
     tier text NOT NULL DEFAULT 'standalone',
     quantity integer NOT NULL DEFAULT 1,
     stripe_customer_id text,
     stripe_subscription_id text,
     stripe_price_id text,
     status text NOT NULL DEFAULT 'inactive',
     billing_interval text,
     current_period_end timestamp,
     cancel_at_period_end boolean,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  // One row per account and item: a re-purchase after a cancellation reuses the row (its history stays).
  `CREATE UNIQUE INDEX IF NOT EXISTS alacarte_subscriptions_user_item_idx ON alacarte_subscriptions (user_id, item_key)`,
  `CREATE INDEX IF NOT EXISTS alacarte_subscriptions_stripe_sub_idx ON alacarte_subscriptions (stripe_subscription_id)`,
];

let schemaReady: Promise<void> | null = null;
/** The table exists before the first read. A failure is logged, thrown to the caller, and retried on the next call. */
export function alacarteSchemaReady(): Promise<void> {
  schemaReady ??= (async () => {
    for (const ddl of ALACARTE_SUBSCRIPTION_DDL) await pool.query(ddl);
  })().catch((e: any) => {
    console.error("[alacarte-billing] could not create alacarte_subscriptions:", e?.message || e);
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

export type AlacarteSubscriptionRow = {
  id: number;
  user_id: number;
  item_key: string;
  /** The price tier the subscription is billed at NOW (shared/alacarte.ts AlacarteTier); re-read at every renewal. */
  tier: string;
  quantity: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  status: string;
  billing_interval: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean | null;
};

/** Every à la carte row of an account, in display order of the price book is the caller's job; here by id. */
export async function alacarteSubscriptionRows(userId: number): Promise<AlacarteSubscriptionRow[]> {
  await alacarteSchemaReady();
  const { rows } = await pool.query(`SELECT * FROM alacarte_subscriptions WHERE user_id = $1 ORDER BY id`, [userId]);
  return rows;
}

/** The account's row for one item, or undefined. */
export async function alacarteSubscriptionRow(userId: number, key: AlacarteKey): Promise<AlacarteSubscriptionRow | undefined> {
  await alacarteSchemaReady();
  const { rows: [row] } = await pool.query(`SELECT * FROM alacarte_subscriptions WHERE user_id = $1 AND item_key = $2 LIMIT 1`, [userId, key]);
  return row;
}

/**
 * The column server/entitlements.ts accountSubscriptionRow (and the batch
 * module query) joins in beside the platform row: every à la carte row of the
 * account as one JSON array, so one query answers every product.
 * `u` is the users alias of the enclosing query.
 */
export const ALACARTE_JOIN_COLUMN =
  "(SELECT coalesce(json_agg(json_build_object('key', a.item_key, 'tier', a.tier, 'quantity', a.quantity, 'status', a.status)), '[]'::json) " +
  "FROM alacarte_subscriptions a WHERE a.user_id = u.id) AS alacarte_items";

export type AlacarteJoinedColumns = { alacarte_items?: unknown };

/** What the account's à la carte rows say, as the entitlements read them. */
export type AlacarteState = {
  /** Items in force: active or trialing (ACCESS_STATUSES), with their quantities. */
  active: AlacarteHolding[];
  /** Items bought but paused for a payment (PAYMENT_NEEDED_STATUSES): shown, never granted. */
  paused: AlacarteKey[];
  /** The tier each live item is billed at now. */
  tiers: Partial<Record<AlacarteKey, AlacarteTier>>;
};

export const NO_ALACARTE: AlacarteState = { active: [], paused: [], tiers: {} };

/** The state out of the joined JSON column (or a list of rows). Unknown keys and statuses are ignored. */
export function alacarteStateOf(raw: unknown): AlacarteState {
  const list: unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? safeJson(raw) : [];
  const out: AlacarteState = { active: [], paused: [], tiers: {} };
  for (const entry of list) {
    const r = (entry ?? {}) as { key?: unknown; item_key?: unknown; tier?: unknown; quantity?: unknown; status?: unknown };
    const key = r.key ?? r.item_key;
    if (!isAlacarteKey(key)) continue;
    const status = typeof r.status === "string" ? r.status : "";
    const quantity = Math.max(1, Math.floor(Number(r.quantity)) || 1);
    if (ACCESS_STATUSES.includes(status)) {
      out.active.push({ key, quantity });
      if (isAlacarteTier(r.tier)) out.tiers[key] = r.tier;
    } else if (PAYMENT_NEEDED_STATUSES.includes(status)) {
      out.paused.push(key);
      if (isAlacarteTier(r.tier)) out.tiers[key] = r.tier;
    }
  }
  return out;
}

function safeJson(s: string): unknown[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** The active keys of a state. */
export const activeAlacarteKeys = (state: AlacarteState): AlacarteKey[] => state.active.map((h) => h.key);

/** A stored interval as BillingInterval, or null. */
export const alacarteIntervalOf = (value: unknown): BillingInterval | null => (value === "month" || value === "year" ? value : null);
