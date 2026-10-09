/**
 * The customer's SEO data credit (shared/seo-credits.ts): the plan's monthly
 * allowance and the prepaid balance, charged at SEO_MARKUP x the wholesale cost.
 *
 * Every vendor call already goes through server/seo/budget.ts
 * (reserveBudget -> settleBudget), so that is where the customer is charged:
 * the estimate is reserved before the call and settled to the real cost after.
 * Nothing in the SEO routes or jobs charges credit on its own.
 *
 *   seo_credit_usage      per account per month: allowance used, purchased credit used
 *   seo_credit_wallets    purchased credit left
 *   seo_credit_purchases  one row per paid Stripe checkout (the session id is unique,
 *                         so a redelivered webhook never credits twice), with its PaymentIntent
 *                         and how much of it was refunded or lost to a dispute
 *   seo_credit_ledger     every movement of purchased credit, with the Stripe ids
 *   seo_credit_disputes   one row per Stripe dispute on a pack (credit-reversals.ts)
 *
 * The wallet: balance_cents = purchased credit that can be spent; frozen_cents = on hold while a dispute about its
 * payment is open; owed_cents = credit taken back after it was spent (a refund or a lost dispute) — while anything is
 * owed, lookups that cost credit are refused, and the next pack bought pays it first.
 */
import type { PoolClient } from "pg";
import { pool } from "../db";
import { retailCents, splitCharge, creditUsd, SEO_CREDIT_PACKS, type SeoCredits } from "@shared/seo-credits";

export const CREDIT_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_credit_usage (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month text NOT NULL,
    included_cents integer NOT NULL DEFAULT 0,
    wallet_cents integer NOT NULL DEFAULT 0,
    requests integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, month)
  )`,
  `CREATE TABLE IF NOT EXISTS seo_credit_wallets (
    user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS seo_credit_purchases (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cents integer NOT NULL CHECK (cents > 0),
    stripe_session_id text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  // One row per reserved lookup (server/seo/budget.ts). Open until settled, so a
  // reservation the process never got to settle (crash, restart, database error)
  // is found and finished by reconcileReservations instead of staying charged.
  `CREATE TABLE IF NOT EXISTS seo_reservations (
    id uuid PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month text NOT NULL,
    estimate_usd numeric(12,6) NOT NULL,
    credit jsonb,
    actual_usd numeric(12,6),
    customer_usd numeric(12,6),
    settled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS seo_reservations_open ON seo_reservations(created_at) WHERE settled_at IS NULL`,
  // Review M-3: refunds, disputes and failed bank debits (server/seo/credit-reversals.ts).
  `ALTER TABLE seo_credit_wallets ADD COLUMN IF NOT EXISTS frozen_cents integer NOT NULL DEFAULT 0 CHECK (frozen_cents >= 0)`,
  `ALTER TABLE seo_credit_wallets ADD COLUMN IF NOT EXISTS owed_cents integer NOT NULL DEFAULT 0 CHECK (owed_cents >= 0)`,
  `ALTER TABLE seo_credit_purchases ADD COLUMN IF NOT EXISTS stripe_payment_intent text`,
  `ALTER TABLE seo_credit_purchases ADD COLUMN IF NOT EXISTS refunded_cents integer NOT NULL DEFAULT 0`,
  `ALTER TABLE seo_credit_purchases ADD COLUMN IF NOT EXISTS disputed_lost_cents integer NOT NULL DEFAULT 0`,
  `ALTER TABLE seo_credit_purchases ADD COLUMN IF NOT EXISTS reversed_at timestamptz`,
  `CREATE UNIQUE INDEX IF NOT EXISTS seo_credit_purchases_pi ON seo_credit_purchases(stripe_payment_intent) WHERE stripe_payment_intent IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS seo_credit_disputes (
    dispute_id text PRIMARY KEY,
    purchase_id integer NOT NULL REFERENCES seo_credit_purchases(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status text NOT NULL,
    amount_cents integer NOT NULL,
    held_cents integer NOT NULL DEFAULT 0,
    lost_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS seo_credit_ledger (
    id bigserial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purchase_id integer REFERENCES seo_credit_purchases(id) ON DELETE SET NULL,
    kind text NOT NULL,
    wallet_delta integer NOT NULL DEFAULT 0,
    frozen_delta integer NOT NULL DEFAULT 0,
    owed_delta integer NOT NULL DEFAULT 0,
    stripe_event_id text,
    stripe_object_id text,
    stripe_payment_intent text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS seo_credit_ledger_user ON seo_credit_ledger(user_id, created_at DESC)`,
];

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const UNLIMITED = -1;

/** What the customer reads when a lookup needs more credit than they have. */
export function outOfCreditMessage(needCents: number, availableCents: number): string {
  return `This needs about ${creditUsd(needCents)} of SEO data and you have ${creditUsd(Math.max(0, availableCents))} left this month. ` +
    `Add credit to keep going — your plan's allowance comes back on the 1st.`;
}

export class SeoCreditShort extends Error {
  constructor(readonly needCents: number, readonly availableCents: number, message = outOfCreditMessage(needCents, availableCents)) {
    super(message);
    this.name = "SeoCreditShort";
  }
}

/** What the customer reads while credit is owed (a refunded or disputed pack whose credit was already used). */
export function owedCreditMessage(owedCents: number): string {
  return `A payment for SEO data credit was refunded or disputed after that credit had been used, so your SEO data credit is ` +
    `${creditUsd(owedCents)} below zero. SEO lookups are paused until it is settled: add credit and the ${creditUsd(owedCents)} is settled first. ` +
    `Questions? Email support@constructhub.us.`;
}
/** What the customer reads while some purchased credit is on hold. */
export function frozenCreditMessage(frozenCents: number): string {
  return `${creditUsd(frozenCents)} of your purchased SEO data credit is on hold while a dispute about its payment is open. ` +
    `It can't be used until the dispute is decided.`;
}
/** The plain-words line the account shows about its credit, or null when there is nothing to say. */
export function creditNotice(owedCents: number, frozenCents: number): string | null {
  if (owedCents > 0) return owedCreditMessage(owedCents) + (frozenCents > 0 ? ` ${frozenCreditMessage(frozenCents)}` : "");
  return frozenCents > 0 ? frozenCreditMessage(frozenCents) : null;
}

/** Credit is owed: no lookup that costs credit runs until it is settled. */
export class SeoCreditOwed extends SeoCreditShort {
  constructor(needCents: number, readonly owedCents: number) {
    super(needCents, 0, owedCreditMessage(owedCents));
    this.name = "SeoCreditOwed";
  }
}

export type CreditReservation = { userId: number; month: string; fromIncluded: number; fromWallet: number; allowanceCents: number } & { /** Never draws on purchased credit (automatic jobs). */ allowanceOnly?: boolean };

/** This account's allowance and purchased credit right now. */
export async function creditStatus(userId: number, allowanceCents: number): Promise<SeoCredits> {
  const { rows: [row] } = await pool.query(
    `SELECT coalesce((SELECT included_cents FROM seo_credit_usage WHERE user_id=$1 AND month=$2),0)::int AS used,
            coalesce((SELECT balance_cents FROM seo_credit_wallets WHERE user_id=$1),0)::int AS wallet,
            coalesce((SELECT frozen_cents FROM seo_credit_wallets WHERE user_id=$1),0)::int AS frozen,
            coalesce((SELECT owed_cents FROM seo_credit_wallets WHERE user_id=$1),0)::int AS owed`, [userId, monthKey()]);
  const used = Number(row?.used ?? 0), wallet = Number(row?.wallet ?? 0), frozen = Number(row?.frozen ?? 0), owed = Number(row?.owed ?? 0);
  const extra = { frozenCents: frozen, owedCents: owed, notice: creditNotice(owed, frozen) };
  if (allowanceCents === UNLIMITED) return { includedCents: UNLIMITED, includedUsedCents: used, walletCents: wallet, availableCents: UNLIMITED, ...extra };
  return { includedCents: allowanceCents, includedUsedCents: Math.min(used, allowanceCents), walletCents: wallet, availableCents: owed > 0 ? 0 : Math.max(0, allowanceCents - used) + wallet, ...extra };
}

/**
 * Take `cents` from the month's allowance, then from purchased credit — or throw
 * SeoCreditShort and take nothing. One transaction with the account's rows locked,
 * so two lookups at once cannot both spend the last dollar.
 */
export async function reserveCredits(userId: number, allowanceCents: number, cents: number, opts: { allowanceOnly?: boolean; /** seo_reservations row to record this on, in the same transaction. */ reservationId?: string; /** The usage month, chosen once by the caller so both ledgers agree across midnight on the 1st. */ month?: string } = {}): Promise<CreditReservation | null> {
  if (allowanceCents === UNLIMITED || cents <= 0) return null;
  const month = opts.month ?? monthKey();
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO seo_credit_usage(user_id, month) VALUES($1,$2) ON CONFLICT DO NOTHING`, [userId, month]);
    await client.query(`INSERT INTO seo_credit_wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING`, [userId]);
    const { rows: [u] } = await client.query(`SELECT included_cents FROM seo_credit_usage WHERE user_id=$1 AND month=$2 FOR UPDATE`, [userId, month]);
    const { rows: [w] } = await client.query(`SELECT balance_cents, owed_cents FROM seo_credit_wallets WHERE user_id=$1 FOR UPDATE`, [userId]);
    // Credit is owed (a refunded or disputed pack that was already spent): nothing that costs credit runs, the
    // month's allowance included, until it is settled (review M-3).
    if (Number(w.owed_cents) > 0) {
      await client.query("ROLLBACK");
      throw new SeoCreditOwed(cents, Number(w.owed_cents));
    }
    const left = Math.max(0, allowanceCents - Number(u.included_cents)), wallet = opts.allowanceOnly ? 0 : Number(w.balance_cents);
    const split = splitCharge(cents, left, wallet);
    if (split.short > 0) {
      await client.query("ROLLBACK");
      throw new SeoCreditShort(cents, left + wallet);
    }
    await client.query(
      `UPDATE seo_credit_usage SET included_cents=included_cents+$3, wallet_cents=wallet_cents+$4, requests=requests+1, updated_at=now() WHERE user_id=$1 AND month=$2`,
      [userId, month, split.fromIncluded, split.fromWallet]);
    if (split.fromWallet) await client.query(`UPDATE seo_credit_wallets SET balance_cents=balance_cents-$2, updated_at=now() WHERE user_id=$1`, [userId, split.fromWallet]);
    const reservation: CreditReservation = { userId, month, fromIncluded: split.fromIncluded, fromWallet: split.fromWallet, allowanceCents, allowanceOnly: !!opts.allowanceOnly };
    if (opts.reservationId) {
      // Only onto a reservation that is still open: one that was closed meanwhile must not end up holding credit.
      const { rowCount } = await client.query(`UPDATE seo_reservations SET credit=$2 WHERE id=$1 AND settled_at IS NULL`, [opts.reservationId, JSON.stringify(reservation)]);
      if (!rowCount) throw new Error(`reservation ${opts.reservationId} is no longer open`);
    }
    await client.query("COMMIT");
    return reservation;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Replace a reservation with the real charge. Less than reserved: purchased
 * credit is given back first (it is the customer's money), then the allowance.
 * More than reserved: the extra comes from the allowance, then purchased credit,
 * and never drives a balance below zero.
 */
/** What a settlement moved: added to (or, negative, given back from) the allowance used and the purchased credit. */
export type CreditDelta = { dIncluded: number; dWallet: number };
export async function settleCredits(r: CreditReservation | null, actualCents: number, tx?: PoolClient): Promise<CreditDelta> {
  const none: CreditDelta = { dIncluded: 0, dWallet: 0 };
  if (!r) return none;
  const reserved = r.fromIncluded + r.fromWallet;
  const delta = actualCents - reserved;
  if (delta === 0) return none;
  const apply = async (client: PoolClient) => {
    const { rows: [u] } = await client.query(`SELECT included_cents FROM seo_credit_usage WHERE user_id=$1 AND month=$2 FOR UPDATE`, [r.userId, r.month]);
    const { rows: [w] } = await client.query(`SELECT balance_cents FROM seo_credit_wallets WHERE user_id=$1 FOR UPDATE`, [r.userId]);
    let dIncluded = 0, dWallet = 0;
    if (delta < 0) {
      const back = -delta;
      dWallet = -Math.min(back, r.fromWallet);
      dIncluded = -(back + dWallet);
    } else {
      const split = splitCharge(delta, Math.max(0, r.allowanceCents - Number(u?.included_cents ?? 0)), r.allowanceOnly ? 0 : Number(w?.balance_cents ?? 0));
      dIncluded = split.fromIncluded; dWallet = split.fromWallet;
      // The call cost more than was reserved and the account cannot cover the rest: we absorb it, on the record.
      if (split.short > 0) console.warn(`[seo] credit short on settle user=${r.userId} month=${r.month} unpaid=${split.short}c`);
    }
    await client.query(
      `UPDATE seo_credit_usage SET included_cents=greatest(0,included_cents+$3), wallet_cents=greatest(0,wallet_cents+$4), updated_at=now() WHERE user_id=$1 AND month=$2`,
      [r.userId, r.month, dIncluded, dWallet]);
    if (dWallet) await client.query(`UPDATE seo_credit_wallets SET balance_cents=greatest(0,balance_cents-$2), updated_at=now() WHERE user_id=$1`, [r.userId, dWallet]);
    return { dIncluded, dWallet };
  };
  // Inside the caller's transaction (budget.ts settles the reservation row and both ledgers together)...
  if (tx) return apply(tx);
  // ...or in one of its own.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const moved = await apply(client);
    await client.query("COMMIT");
    return moved;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * A paid credit-pack checkout: add the credit once. Returns the cents added, or
 * 0 when this session was already credited (a redelivered webhook) or is not a
 * paid credit pack. The amount is what Stripe says was paid for a pack we sell —
 * never a number read from metadata alone.
 */
export async function fulfilSeoCredits(session: { id: string; mode?: string | null; payment_status?: string | null; amount_total?: number | null; payment_intent?: string | { id: string } | null; metadata?: Record<string, string> | null }, userId: number, eventId: string | null = null): Promise<number> {
  if (session.metadata?.type !== "seo_credits" || session.mode !== "payment" || session.payment_status !== "paid") return 0;
  const cents = Number(session.metadata?.cents);
  if (!SEO_CREDIT_PACKS.includes(cents) || session.amount_total !== cents) {
    throw new Error(`[seo] credit checkout ${session.id}: pack ${session.metadata?.cents} does not match the ${session.amount_total} paid — nothing credited`);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
    const { rows } = await client.query(
      `INSERT INTO seo_credit_purchases(user_id, cents, stripe_session_id, stripe_payment_intent) VALUES($1,$2,$3,$4) ON CONFLICT (stripe_session_id) DO NOTHING RETURNING id`, [userId, cents, session.id, pi]);
    if (rows.length) {
      // What is owed (a pack refunded or disputed after its credit was used) is settled first; the rest is credit.
      await client.query(`INSERT INTO seo_credit_wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING`, [userId]);
      const { rows: [w] } = await client.query(`SELECT owed_cents FROM seo_credit_wallets WHERE user_id=$1 FOR UPDATE`, [userId]);
      const settles = Math.min(Number(w.owed_cents), cents);
      await client.query(`UPDATE seo_credit_wallets SET balance_cents=balance_cents+$2, owed_cents=owed_cents-$3, updated_at=now() WHERE user_id=$1`, [userId, cents - settles, settles]);
      for (const [kind, wallet, owed] of [["purchase", cents, 0], ["owed_settled", -settles, -settles]] as const)
        if (wallet || owed)
          await client.query(
            `INSERT INTO seo_credit_ledger(user_id, purchase_id, kind, wallet_delta, owed_delta, stripe_event_id, stripe_object_id, stripe_payment_intent) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [userId, rows[0].id, kind, wallet, owed, eventId, session.id, pi]);
    }
    await client.query("COMMIT");
    if (rows.length) console.log(`[seo] credit: user ${userId} bought ${creditUsd(cents)} (checkout ${session.id})`);
    return rows.length ? cents : 0;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export { retailCents };
