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

export type BudgetReservation = { userId: number; month: string; estimateUsd: number; credit: CreditReservation | null; /** Set by settleBudget: a reservation settles once. */ settled?: boolean };
/** `allowanceOnly`: spend the month's included SEO data only, never credit the customer bought (automatic jobs). */
export type BudgetOptions = { allowanceOnly?: boolean };

/** Reserve `estimateUsd` for this account, or throw SeoBudgetError. */
export async function reserveBudget(userId: number, estimateUsd: number, opts: BudgetOptions = {}): Promise<BudgetReservation> {
  const month = monthKey();
  const cap = monthlyBudgetUsd();
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
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  // The customer's side of the same call: the estimate at the customer's price,
  // from this month's allowance and then purchased credit (server/seo/credits.ts).
  const reservation: BudgetReservation = { userId, month, estimateUsd, credit: null };
  try {
    reservation.credit = await budgetDeps.reserveCredits(userId, await budgetDeps.allowanceCents(userId), retailCents(estimateUsd), opts);
  } catch (e) {
    // Nothing will run: give the wholesale reservation back before refusing.
    await pool.query("UPDATE seo_api_usage SET cost_usd=greatest(0,cost_usd-$3), requests=greatest(0,requests-1), updated_at=now() WHERE user_id=$1 AND month=$2", [userId, month, estimateUsd]).catch(() => {});
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
 * A reservation settles exactly once: a second call is ignored, so an error
 * after settling can never refund the same reservation twice.
 */
export async function settleBudget(r: BudgetReservation, actualUsd: number, customerUsd = actualUsd): Promise<void> {
  if (r.settled) return;
  r.settled = true;
  console.info(`[seo] cost user=${r.userId} month=${r.month} estimate=${usd(r.estimateUsd)} actual=${usd(actualUsd)} charged=${retailCents(customerUsd)}c`);
  await budgetDeps.settleCredits(r.credit, retailCents(customerUsd)).catch((e: any) => console.error(`[seo] credit settle failed user=${r.userId}: ${e?.message ?? e}`));
  const delta = round6(actualUsd - r.estimateUsd);
  if (delta === 0) return;
  await pool.query(
    "UPDATE seo_api_usage SET cost_usd=greatest(0,cost_usd+$3), updated_at=now() WHERE user_id=$1 AND month=$2",
    [r.userId, r.month, delta]);
}

/** Nothing was charged (request refused before DataForSEO ran it): give the estimate back. */
export const releaseBudget = (r: BudgetReservation) => settleBudget(r, 0);

/**
 * Run a metered call: reserve the estimate, then settle to the reported cost.
 * A call that fails costs the customer nothing — they got nothing. Our own
 * ledger keeps what the source says it charged, or the whole estimate when it
 * never answered (timeout, gateway error) and the cost is unknown.
 */
export async function withBudget<T>(userId: number, estimateUsd: number, call: () => Promise<{ data: T; costUsd: number }>, opts: BudgetOptions = {}): Promise<{ data: T; costUsd: number }> {
  const r = await reserveBudget(userId, estimateUsd, opts);
  let out: { data: T; costUsd: number };
  try {
    out = await call();
  } catch (e: any) {
    const reported = typeof e?.costUsd === "number" ? e.costUsd : 0;
    const unknown = e?.code === "timeout" || e?.code === "upstream";
    const ours = reported > 0 ? reported : unknown ? estimateUsd : 0;
    await settleBudget(r, ours, 0).catch((s: any) => console.error(`[seo] settle after a failed call did not complete user=${userId}: ${s?.message ?? s}`));
    throw e;
  }
  // The data is in hand: a ledger error here must not lose a result that was paid for.
  await settleBudget(r, out.costUsd).catch((s: any) => console.error(`[seo] settle did not complete user=${userId} cost=${usd(out.costUsd)}: ${s?.message ?? s}`));
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
