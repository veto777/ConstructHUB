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
  readonly code = "seo_budget";
  /** `message` is customer-safe; `detail` carries the dollars for the log and the admin card. */
  constructor(message: string, readonly remainingUsd: number, readonly estimateUsd: number, readonly detail = message) {
    super(message);
    this.name = "SeoBudgetError";
  }
}

export type BudgetReservation = { userId: number; month: string; estimateUsd: number };

/** Reserve `estimateUsd` for this account, or throw SeoBudgetError. */
export async function reserveBudget(userId: number, estimateUsd: number): Promise<BudgetReservation> {
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
    return { userId, month, estimateUsd };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Replace the reservation with what DataForSEO actually charged (`cost` on the task). Every settlement is one log line. */
export async function settleBudget(r: BudgetReservation, actualUsd: number): Promise<void> {
  console.info(`[seo] cost user=${r.userId} month=${r.month} estimate=${usd(r.estimateUsd)} actual=${usd(actualUsd)}`);
  const delta = round6(actualUsd - r.estimateUsd);
  if (delta === 0) return;
  await pool.query(
    "UPDATE seo_api_usage SET cost_usd=greatest(0,cost_usd+$3), updated_at=now() WHERE user_id=$1 AND month=$2",
    [r.userId, r.month, delta]);
}

/** Nothing was charged (request refused before DataForSEO ran it): give the estimate back. */
export const releaseBudget = (r: BudgetReservation) => settleBudget(r, 0);

/** Run a metered call: reserve the estimate, settle to the reported cost, release on a failure that cost nothing. */
export async function withBudget<T>(userId: number, estimateUsd: number, call: () => Promise<{ data: T; costUsd: number }>): Promise<{ data: T; costUsd: number }> {
  const r = await reserveBudget(userId, estimateUsd);
  try {
    const out = await call();
    await settleBudget(r, out.costUsd);
    return out;
  } catch (e: any) {
    // A task DataForSEO charged and then failed carries its cost; anything else cost nothing.
    const charged = typeof e?.costUsd === "number" ? e.costUsd : 0;
    await settleBudget(r, charged).catch(() => {});
    throw e;
  }
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
