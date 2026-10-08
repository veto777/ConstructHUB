/**
 * Monthly DataForSEO spend cap — INTERNAL. SEO_MONTHLY_BUDGET_USD (default
 * 100) is the most the platform spends at DataForSEO in one calendar month
 * (UTC), summed over every account: it is one DataForSEO balance. Spend is
 * recorded per paying account per month in seo_api_usage (cost + request
 * count) and every cost line is logged ("[seo] cost …").
 *
 * Customers never see the vendor, the dollars or the env variable: their
 * allowance is in plan units (shared/plans.ts SEO_PLAN_LIMITS, enforced in
 * server/seo/routes.ts). This cap is the safety net behind those limits; when
 * it trips the customer-facing message is a neutral "paused for the month"
 * (SeoBudgetError.message) and the detail goes to the log / the admin card.
 *
 * Reserve-then-settle: a call reserves its estimated upper bound (pricing.ts)
 * under an advisory lock, runs, then settles to what DataForSEO reported on the
 * task (`cost`), or gives the reservation back when nothing was charged.
 */
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { retailCents } from "@shared/seo-credits";
import { reserveCredits, settleCredits, SeoCreditShort, type CreditReservation } from "./credits";

/**
 * Swappable for tests. `allowanceCents` is the account's monthly SEO data
 * allowance at the customer's price (shared/plans.ts seoCreditCents; -1 =
 * unlimited for platform staff; 0 without a plan).
 */
export const budgetDeps = {
  allowanceCents: async (userId: number): Promise<number> => {
    const { getEntitlements } = await import("../entitlements");
    return (await getEntitlements(userId)).allowances?.seoCreditCents ?? 0;
  },
  reserveCredits, settleCredits,
};

export const DEFAULT_MONTHLY_BUDGET_USD = 100;
const LOCK_KEY = 7191;

export function monthlyBudgetUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SEO_MONTHLY_BUDGET_USD);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MONTHLY_BUDGET_USD;
}

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export type BudgetDecision =
  | { ok: true; remainingUsd: number }
  | { ok: false; remainingUsd: number; message: string; detail: string };

/** What a customer reads when the internal cap trips: no vendor, no dollars, no env names. */
export const BUDGET_PAUSED_MESSAGE =
  "SEO checks are paused for the rest of the month — the monthly data allowance for rank tracking is used up. It comes back on the 1st.";

/** The one rule: a call may run only when the whole estimate fits under the cap. Pure, for tests. */
export function budgetDecision(spentUsd: number, estimateUsd: number, capUsd: number): BudgetDecision {
  const remaining = Math.max(0, round6(capUsd - spentUsd));
  if (estimateUsd <= remaining + 1e-9) return { ok: true, remainingUsd: round6(remaining - estimateUsd) };
  return {
    ok: false,
    remainingUsd: remaining,
    message: BUDGET_PAUSED_MESSAGE,
    detail: `This needs about ${usd(estimateUsd)} of DataForSEO data and ${usd(remaining)} of the ${usd(capUsd)} monthly cap is left. ` +
      `The cap resets on the 1st (UTC); raise SEO_MONTHLY_BUDGET_USD on the server to allow more.`,
  };
}

export class SeoBudgetError extends Error {
  /**
   * `message` is customer-safe; `detail` carries the dollars for the log and the admin card.
   * `code` is "seo_budget" (the platform's internal cap) or "seo_credits" (this
   * customer's own allowance and purchased credit are used up).
   */
  constructor(message: string, readonly remainingUsd: number, readonly estimateUsd: number, readonly detail = message, readonly code: "seo_budget" | "seo_credits" = "seo_budget") {
    super(message);
    this.name = "SeoBudgetError";
  }
}

export type BudgetReservation = { /** seo_reservations row: what makes the settlement survive a crash. */ id?: string; userId: number; month: string; estimateUsd: number; credit: CreditReservation | null; /** Set by settleBudget: a reservation settles once. */ settled?: boolean };
/** `allowanceOnly`: spend the month's included SEO data only, never credit the customer bought (automatic jobs). */
export type BudgetOptions = { allowanceOnly?: boolean; /** What this lookup is, in the customer's words — shown in their usage history. */ label?: string };

/** Reserve `estimateUsd` for this account, or throw SeoBudgetError. */
export async function reserveBudget(userId: number, estimateUsd: number, opts: BudgetOptions = {}): Promise<BudgetReservation> {
  const month = monthKey();
  const cap = monthlyBudgetUsd();
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
    const { rows: [row] } = await client.query(
      "SELECT coalesce(sum(cost_usd),0)::float8 AS spent FROM seo_api_usage WHERE month=$1", [month]);
    const decision = budgetDecision(Number(row?.spent ?? 0), estimateUsd, cap);
    if (!decision.ok) {
      await client.query("ROLLBACK");
      console.warn(`[seo] cost refused user=${userId} month=${month} ${decision.detail}`);
      throw new SeoBudgetError(decision.message, decision.remainingUsd, estimateUsd, decision.detail);
    }
    await client.query(
      `INSERT INTO seo_api_usage(user_id,month,cost_usd,requests) VALUES($1,$2,$3,1)
       ON CONFLICT(user_id,month) DO UPDATE SET cost_usd=seo_api_usage.cost_usd+EXCLUDED.cost_usd, requests=seo_api_usage.requests+1, updated_at=now()`,
      [userId, month, estimateUsd]);
    // Recorded with the reservation itself: if this process never settles it, reconcileReservations will.
    await client.query("INSERT INTO seo_reservations(id,user_id,month,estimate_usd,label) VALUES($1,$2,$3,$4,$5)", [id, userId, month, estimateUsd, opts.label ? opts.label.slice(0, 200) : null]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  // The customer's side of the same call: the estimate at the customer's price,
  // from this month's allowance and then purchased credit (server/seo/credits.ts).
  const reservation: BudgetReservation = { id, userId, month, estimateUsd, credit: null };
  try {
    reservation.credit = await budgetDeps.reserveCredits(userId, await budgetDeps.allowanceCents(userId), retailCents(estimateUsd), { allowanceOnly: opts.allowanceOnly, reservationId: id });
  } catch (e) {
    if (!(e instanceof SeoCreditShort)) {
      // The error may have arrived after the credit was in fact taken (a lost acknowledgement). The reservation row is
      // written in that same transaction, so it says which: credit on the row = taken, proceed as reserved.
      const held = await pool.query("SELECT credit FROM seo_reservations WHERE id=$1 AND settled_at IS NULL", [id]).then((r) => r.rows[0]?.credit ?? null, () => undefined);
      if (held) { reservation.credit = held; return reservation; }
      // Cannot tell: leave the row open for the reconciler instead of guessing.
      if (held === undefined) throw e;
    }
    // Nothing will run: close the reservation and give the wholesale estimate back, together.
    await pool.query(
      `WITH closed AS (UPDATE seo_reservations SET settled_at=now(), actual_usd=0, customer_usd=0 WHERE id=$4 AND settled_at IS NULL RETURNING 1)
       UPDATE seo_api_usage SET cost_usd=greatest(0,cost_usd-$3), requests=greatest(0,requests-1), updated_at=now()
        WHERE user_id=$1 AND month=$2 AND EXISTS (SELECT 1 FROM closed)`, [userId, month, estimateUsd, id]).catch(() => {});
    if (e instanceof SeoCreditShort) {
      console.warn(`[seo] credit refused user=${userId} month=${month} need=${e.needCents}c available=${e.availableCents}c`);
      throw new SeoBudgetError(e.message, 0, estimateUsd, e.message, "seo_credits");
    }
    throw e;
  }
  return reservation;
}

/**
 * Replace the reservation with what the call really cost. `actualUsd` is our
 * own (wholesale) cost; the customer is charged `customerUsd` at their price —
 * the same amount unless the call failed, when they are charged nothing.
 *
 * Settles once. The reservation row, the customer's credit and our ledger
 * change in ONE transaction, with the outcome handed in — never read back from
 * a separate write. If that transaction fails the outcome is left on the row,
 * so reconcileReservations finishes it with the real numbers. Never throws.
 */
export async function settleBudget(r: BudgetReservation, actualUsd: number, customerUsd = actualUsd): Promise<void> {
  if (r.settled) return;
  r.settled = true;
  console.info(`[seo] cost user=${r.userId} month=${r.month} estimate=${usd(r.estimateUsd)} actual=${usd(actualUsd)} charged=${retailCents(customerUsd)}c`);
  if (!r.id) {
    // No reservation row (built by hand, as the unit tests do): settle the two ledgers directly.
    await budgetDeps.settleCredits(r.credit, retailCents(customerUsd)).catch((e: any) => console.error(`[seo] credit settle failed user=${r.userId}: ${e?.message ?? e}`));
    const delta = round6(actualUsd - r.estimateUsd);
    if (delta !== 0) await pool.query("UPDATE seo_api_usage SET cost_usd=greatest(0,cost_usd+$3), updated_at=now() WHERE user_id=$1 AND month=$2", [r.userId, r.month, delta]).catch((e: any) => console.error(`[seo] ledger settle failed user=${r.userId}: ${e?.message ?? e}`));
    return;
  }
  try {
    await applySettlement(r.id, { actualUsd, customerUsd });
  } catch (e: any) {
    console.error(`[seo] settlement of ${r.id} did not complete (it will be retried): ${e?.message ?? e}`);
    await pool.query("UPDATE seo_reservations SET actual_usd=$2, customer_usd=$3 WHERE id=$1 AND settled_at IS NULL", [r.id, actualUsd, customerUsd])
      .catch((w: any) => console.error(`[seo] could not record the outcome of ${r.id} either — the reconciler will close it at no charge to the customer: ${w?.message ?? w}`));
  }
}

/**
 * Close one reservation: the customer's credit, our ledger and the row itself
 * in one transaction, under a lock on the row.
 *
 *   open, outcome known (handed in, or left on the row by a failed settle)  -> settle to it.
 *   open, outcome unknown (the process died mid-call)  -> the customer is charged nothing, our ledger keeps
 *     the estimate, and the row is marked `reconciled`.
 *   closed as `reconciled`, and the real outcome now arrives (the call was only slow)  -> settle the
 *     difference, so a late result is paid for like any other.
 *   closed otherwise  -> nothing to do.
 * Returns whether anything changed.
 */
/** The credit record after a settlement: what was held, plus or minus what the settlement moved. */
function finalCredit(held: CreditReservation | null, moved: { dIncluded: number; dWallet: number } | void): string | null {
  if (!held) return null;
  return JSON.stringify({ ...held, fromIncluded: Math.max(0, held.fromIncluded + (moved?.dIncluded ?? 0)), fromWallet: Math.max(0, held.fromWallet + (moved?.dWallet ?? 0)) });
}

export async function applySettlement(id: string, outcome?: { actualUsd: number; customerUsd: number }): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [row] } = await client.query("SELECT * FROM seo_reservations WHERE id=$1 FOR UPDATE", [id]);
    if (!row) { await client.query("ROLLBACK"); return false; }
    const estimate = Number(row.estimate_usd);
    const ledger = async (delta: number) => {
      if (round6(delta) !== 0) await client.query("UPDATE seo_api_usage SET cost_usd=greatest(0,cost_usd+$3), updated_at=now() WHERE user_id=$1 AND month=$2", [row.user_id, row.month, round6(delta)]);
    };
    if (row.settled_at) {
      if (!row.reconciled || !outcome) { await client.query("ROLLBACK"); return false; }
      // Nothing is held any more (the reconciler gave it all back): charge what the lookup really cost.
      const held = row.credit ? { ...row.credit, fromIncluded: 0, fromWallet: 0 } : null;
      const moved = await budgetDeps.settleCredits(held, retailCents(outcome.customerUsd), client);
      await ledger(outcome.actualUsd - Number(row.actual_usd ?? estimate));
      await client.query("UPDATE seo_reservations SET reconciled=false, actual_usd=$2, customer_usd=$3, credit=$4 WHERE id=$1", [id, outcome.actualUsd, outcome.customerUsd, finalCredit(held, moved)]);
      await client.query("COMMIT");
      console.warn(`[seo] reservation ${id} finished after it had been closed as abandoned; settled late`);
      return true;
    }
    const known = outcome ?? (row.actual_usd !== null ? { actualUsd: Number(row.actual_usd), customerUsd: Number(row.customer_usd ?? 0) } : null);
    const actual = known ? known.actualUsd : estimate, customer = known ? known.customerUsd : 0;
    const moved = await budgetDeps.settleCredits(row.credit ?? null, retailCents(customer), client);
    await ledger(actual - estimate);
    // From here on the row's credit is what the lookup finally took, not what was set aside for it.
    await client.query("UPDATE seo_reservations SET settled_at=now(), actual_usd=$2, customer_usd=$3, reconciled=$4, credit=$5 WHERE id=$1", [id, actual, customer, !known, finalCredit(row.credit ?? null, moved)]);
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Give back part of what a settled lookup cost the customer: paid work that was
 * never delivered (rank checks that never came back). Purchased credit first.
 * `key` makes it happen once. Returns the cents refunded.
 */
export async function refundReservation(id: string, cents: number, key: string): Promise<number> {
  if (!(cents >= 1)) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [row] } = await client.query("SELECT * FROM seo_reservations WHERE id=$1 FOR UPDATE", [id]);
    if (!row || !row.settled_at || !row.credit || row.refund_key === key) { await client.query("ROLLBACK"); return 0; }
    // The row's credit is what the lookup took (and has not yet been refunded), split by where it came from.
    const fromIncluded = Number(row.credit.fromIncluded ?? 0), fromWallet = Number(row.credit.fromWallet ?? 0);
    const give = Math.min(Math.floor(cents), fromIncluded + fromWallet);
    if (give <= 0) { await client.query("ROLLBACK"); return 0; }
    const dWallet = Math.min(give, fromWallet), dIncluded = give - dWallet;
    await client.query("UPDATE seo_credit_usage SET included_cents=greatest(0,included_cents-$3), wallet_cents=greatest(0,wallet_cents-$4), updated_at=now() WHERE user_id=$1 AND month=$2", [row.user_id, row.month, dIncluded, dWallet]);
    if (dWallet) await client.query("UPDATE seo_credit_wallets SET balance_cents=balance_cents+$2, updated_at=now() WHERE user_id=$1", [row.user_id, dWallet]);
    await client.query("UPDATE seo_reservations SET refunded_cents=refunded_cents+$2, refund_key=$3, credit=$4 WHERE id=$1", [id, give, key, JSON.stringify({ ...row.credit, fromIncluded: fromIncluded - dIncluded, fromWallet: fromWallet - dWallet })]);
    await client.query("COMMIT");
    console.info(`[seo] refunded ${give}c of reservation ${id} (${key})`);
    return give;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** No single lookup or rank-run posting takes this long; anything still open after it was abandoned. */
export const RESERVATION_STALE_MINUTES = 30;

/** Finish reservations that were never settled (called every minute by the SEO worker). Returns how many it closed. */
export async function reconcileReservations(): Promise<number> {
  const { rows } = await pool.query(
    "SELECT id FROM seo_reservations WHERE settled_at IS NULL AND created_at < now() - make_interval(mins => $1) ORDER BY created_at LIMIT 50", [RESERVATION_STALE_MINUTES]);
  let closed = 0;
  for (const { id } of rows) {
    try { if (await applySettlement(id)) { closed++; console.warn(`[seo] reconciled abandoned reservation ${id}`); } }
    catch (e: any) { console.error(`[seo] reconcile of ${id} failed: ${e?.message ?? e}`); }
  }
  if (Math.random() < 0.01) void pool.query("DELETE FROM seo_reservations WHERE settled_at < now() - interval '90 days'").catch(() => {});
  return closed;
}

/** Nothing was charged (request refused before DataForSEO ran it): give the estimate back. */
export const releaseBudget = (r: BudgetReservation) => settleBudget(r, 0);

/**
 * Run a metered call: reserve the estimate, then settle to the reported cost.
 * A call that fails costs the customer nothing — they got nothing. Our own
 * ledger keeps what the source says it charged, or the whole estimate when it
 * never answered (timeout, gateway error) and the cost is unknown.
 */
export async function withBudget<T>(userId: number, estimateUsd: number, call: () => Promise<{ data: T; costUsd: number; costUnknown?: boolean }>, opts: BudgetOptions = {}): Promise<{ data: T; costUsd: number }> {
  const r = await reserveBudget(userId, estimateUsd, opts);
  let out: { data: T; costUsd: number; costUnknown?: boolean };
  try {
    out = await call();
  } catch (e: any) {
    const reported = typeof e?.costUsd === "number" ? e.costUsd : 0;
    // Part of the cost is unknown (a call timed out or the source never answered): our ledger keeps the whole estimate.
    const unknown = e?.costUnknown === true || e?.code === "timeout" || (e?.code === "upstream" && reported === 0);
    await settleBudget(r, unknown ? Math.max(reported, estimateUsd) : reported, 0);
    // The reservation id travels with the error so nothing downstream has to guess what was (not) charged.
    throw e;
  }
  // The data is in hand: settleBudget never throws, so a ledger error cannot lose a result that was paid for.
  await settleBudget(r, out.costUnknown ? Math.max(out.costUsd, estimateUsd) : out.costUsd, out.costUsd);
  return out;
}

export type BudgetStatus = {
  month: string;
  capUsd: number;
  /** Everyone's DataForSEO spend this month (what the cap measures). */
  spentUsd: number;
  remainingUsd: number;
  /** This account's share. */
  accountUsd: number;
  accountRequests: number;
};

/** Wholesale spend this month per account (admin view: /api/seo/admin/usage). */
export async function monthlySpendByAccount(month = monthKey()): Promise<{ userId: number; email: string | null; costUsd: number; requests: number }[]> {
  const { rows } = await pool.query(
    `SELECT u.user_id, us.email, u.cost_usd::float8 AS cost_usd, u.requests
       FROM seo_api_usage u LEFT JOIN users us ON us.id=u.user_id WHERE u.month=$1 ORDER BY u.cost_usd DESC, u.user_id`, [month]);
  return rows.map((r: any) => ({ userId: r.user_id, email: r.email ?? null, costUsd: round6(Number(r.cost_usd)), requests: Number(r.requests) }));
}

export async function budgetStatus(userId: number): Promise<BudgetStatus> {
  const month = monthKey();
  const capUsd = monthlyBudgetUsd();
  const { rows: [t] } = await pool.query(
    "SELECT coalesce(sum(cost_usd),0)::float8 AS spent FROM seo_api_usage WHERE month=$1", [month]);
  const { rows: [a] } = await pool.query(
    "SELECT cost_usd::float8 AS cost, requests FROM seo_api_usage WHERE user_id=$1 AND month=$2", [userId, month]);
  const spentUsd = round6(Number(t?.spent ?? 0));
  return {
    month, capUsd, spentUsd,
    remainingUsd: Math.max(0, round6(capUsd - spentUsd)),
    accountUsd: round6(Number(a?.cost ?? 0)),
    accountRequests: Number(a?.requests ?? 0),
  };
}

export const usd = (n: number) => `$${n.toFixed(n < 0.1 && n > 0 ? 4 : 2)}`;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
