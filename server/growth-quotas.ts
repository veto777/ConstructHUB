/**
 * Monthly plan quotas (permit searches, ranking-grid credits, Site Scans,
 * Competitor Intel scans) read from shared/plans.ts through server/entitlements.
 * No active plan means no quota: the caller gets the 402 plan_required body,
 * never a silent fallback plan. Quotas belong to the paying account — an agency
 * member acting in the owner's workspace spends the owner's allowance.
 *
 * Reservations are atomic (growth_budgets) and refundable when the work never ran.
 */
import type { Request, Response } from "express";
import { pool } from "./db";
import { takeBudget } from "./growth-limits";
import {
  getEntitlements, cheapestPlanWhere, raiseHint, plural, billedLocationCount, TOP_PLAN,
  type Entitlements, type CountLimit,
} from "./entitlements";
import { PLANS, gridCreditCost, type PlanKey, type PlanLimits, type AddonKey } from "@shared/plans";

export type MeteredFeature = "searches" | "rankings" | "siteScans" | "competitorScans" | "photos" | "texts";

type Meter = {
  /** Upgrade prompt subject: "<what> is included with the Starter plan". */
  what: string;
  /** The counted unit, singular and plural. */
  unit: [string, string?];
  /** The plan limit this meter reads (per month); undefined = fair use on any paid plan. */
  limit?: CountLimit;
  /** Per-location allowance (Agency), multiplied by the billed locations. */
  perLocation?: CountLimit;
  addon?: AddonKey;
};

export const METERS: Record<MeteredFeature, Meter> = {
  searches: { what: "Permit search", unit: ["permit search", "permit searches"], limit: "permitSearches" },
  rankings: { what: "The ranking grid", unit: ["ranking-grid credit"], limit: "gridCredits", perLocation: "gridCreditsPerLocation" },
  siteScans: { what: "Site Scan", unit: ["Site Scan"], limit: "siteScans", perLocation: "siteScansPerLocation" },
  competitorScans: { what: "Competitor Intel", unit: ["Competitor Intel scan"], limit: "competitorScans", addon: "competitor_pack" },
  // The photo optimizer is included on every paid plan (fair use: the growth
  // processing rate limit is the only cap), so it has no monthly count.
  photos: { what: "The Photo Optimizer", unit: ["photo"] },
  // Every text an org sends (client texts, reminders, team alerts), by segment:
  // server/crm/sms.ts reserves here before the carrier sees the text. The
  // texting-number add-on is a carrier number, not segments (shared/plans.ts),
  // so nothing raises this but the plan.
  texts: { what: "Texting", unit: ["text segment"], limit: "teamTextSegments" },
};

/** Ranking-grid credits a grid costs (one per 25 grid points), from the price book so the client shows the same number. */
export { gridCreditCost };

/** Does this plan's allowance include the feature at all? */
const includes = (meter: Meter) => (l: PlanLimits) =>
  !meter.limit || l[meter.limit] === -1 || l[meter.limit] > 0 || (!!meter.perLocation && l[meter.perLocation] > 0);

/**
 * Monthly allowance for a feature: -1 = unlimited / fair use, 0 = not in the plan.
 * `locations` is the billed location count (billedLocationCount), not every row.
 */
export function monthlyLimit(ent: Entitlements, feature: MeteredFeature, locations = 0): number {
  const meter = METERS[feature], a = ent.allowances;
  if (!a) return 0;
  if (!meter.limit) return -1;
  const base = a[meter.limit];
  if (base === -1) return -1;
  // Per-location plans are billed for at least their included locations.
  const billed = Math.max(locations, ent.limits?.locations ?? 0);
  return base + (meter.perLocation ? a[meter.perLocation] * billed : 0);
}

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
export const quotaKey = (userId: number, feature: MeteredFeature, month = monthKey()) => `quota:user:${userId}:${feature}:${month}`;
/** First instant of next month (UTC), when every monthly count resets. */
export function resetsAt(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

/** A reservation still holding `remaining` units that can be given back. */
export type QuotaReservation = { key: string; remaining: number };
/** The 403 body for a spent month — sendLimitReached's shape, built once here so every meter reads the same. */
export type LimitReachedBody = ReturnType<typeof limitBody>;
export type QuotaResult =
  | { ok: true; reservation: QuotaReservation; ent: Entitlements; limit: number }
  | { ok: false; status: 401 | 402; body: Record<string, unknown> }
  | { ok: false; status: 403; body: LimitReachedBody };

async function allowanceFor(userId: number, feature: MeteredFeature) {
  const ent = await getEntitlements(userId);
  const meter = METERS[feature];
  const locations = meter.perLocation && ent.allowances?.[meter.perLocation] ? await billedLocationCount(userId) : 0;
  return { ent, limit: monthlyLimit(ent, feature, locations) };
}

function planRequiredBody(feature: MeteredFeature) {
  const meter = METERS[feature];
  const requiredPlan: PlanKey = cheapestPlanWhere(includes(meter)) ?? TOP_PLAN;
  return {
    code: "plan_required",
    requiredPlan,
    message: `${meter.what} is included with the ${PLANS[requiredPlan].name} plan. Upgrade in Pricing to use it.`,
  };
}

function limitBody(ent: Entitlements, feature: MeteredFeature, limit: number, used: number, amount: number) {
  const meter = METERS[feature];
  const plan = PLANS[ent.accessPlan!].name;
  const units = (n: number) => plural(n, meter.unit[0], meter.unit[1]);
  let raise = meter.limit ? raiseHint(ent, meter.limit, meter.unit, meter.addon) : { text: "", upgradePlan: null, addon: null };
  if (!raise.text && meter.perLocation && ent.allowances?.[meter.perLocation]) {
    raise = { ...raise, text: `${plan} includes ${units(ent.allowances[meter.perLocation])} per linked Google Business Profile location, so linking more locations raises it.` };
  }
  const left = Math.max(0, limit - used);
  const what = left === 0
    ? `You've used all ${units(limit)} your ${plan} plan includes this month.`
    : `This needs ${units(amount)}, and ${left.toLocaleString("en-US")} of the ${units(limit)} your ${plan} plan includes this month ${left === 1 ? "is" : "are"} left.`;
  return {
    code: "limit_reached",
    feature,
    limit,
    used,
    upgradePlan: raise.upgradePlan,
    addon: raise.addon,
    resetsAt: resetsAt(),
    message: `${what} The count resets on the 1st (UTC). ${raise.text}`.trim(),
  };
}

/** Add `amount` to an unlimited meter's month (the same growth_budgets row a capped meter uses); false when the write failed. */
async function countUnlimited(key: string, amount: number): Promise<boolean> {
  if (!Number.isInteger(amount) || amount < 1) return false;
  try {
    await pool.query(
      `INSERT INTO growth_budgets(key,period,used) VALUES($1,'0',$2)
       ON CONFLICT(key,period) DO UPDATE SET used=growth_budgets.used+EXCLUDED.used`, [key, amount]);
    return true;
  } catch (e: any) {
    console.error(`[quota] counting unlimited use failed for ${key}:`, e?.message || e);
    return false;
  }
}

/** Reserve `amount` of a monthly quota for an account (no request needed: workers use this too). */
export async function reserveQuotaFor(userId: number, feature: MeteredFeature, amount = 1): Promise<QuotaResult> {
  const { ent, limit } = await allowanceFor(userId, feature);
  if (!ent.accessPlan || limit === 0) return { ok: false, status: 402, body: planRequiredBody(feature) };
  const key = quotaKey(userId, feature);
  if (limit === -1) {
    // Unlimited (platform admins): never refused. A counted meter still records
    // the use, so Limits & usage shows "12 used · Unlimited" rather than 0; a
    // failed count never blocks the work. Fair-use meters (photos) stay uncounted.
    if (!METERS[feature].limit) return { ok: true, reservation: { key, remaining: 0 }, ent, limit };
    const counted = await countUnlimited(key, amount);
    return { ok: true, reservation: { key, remaining: counted ? amount : 0 }, ent, limit };
  }
  const allowed = await takeBudget(key, limit, amount, Number.MAX_SAFE_INTEGER);
  if (!allowed) {
    const { rows: [row] } = await pool.query("SELECT used FROM growth_budgets WHERE key=$1 AND period='0'", [key]);
    return { ok: false, status: 403, body: limitBody(ent, feature, limit, Number(row?.used ?? 0), amount) };
  }
  return { ok: true, reservation: { key, remaining: amount }, ent, limit };
}

/** The account a request spends quota for: the workspace owner for an agency member. */
export function quotaUserId(req: Request, res: Response): number | null {
  return res.locals?.agencyOwner ?? (req.user as any)?.id ?? null;
}

/** Route helper: reserve or answer 401/402/403. The reservation is kept on res.locals for refundQuota. */
export async function reserveMonthlyQuota(req: Request, res: Response, feature: MeteredFeature, amount = 1): Promise<boolean> {
  const userId = quotaUserId(req, res);
  if (!userId) {
    res.status(401).json({ message: "Sign in to use this. It's included with every paid plan." });
    return false;
  }
  const result = await reserveQuotaFor(userId, feature, amount);
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return false;
  }
  res.locals ||= {};
  res.locals.growthQuota = result.reservation;
  return true;
}

/** Give back up to `amount` units of a reservation (work that never ran). */
export async function refundReservation(reservation: QuotaReservation | undefined, amount: number) {
  if (!reservation || amount <= 0) return;
  const refund = Math.min(amount, reservation.remaining);
  if (refund <= 0) return;
  reservation.remaining -= refund;
  await pool.query("UPDATE growth_budgets SET used=greatest(0,used-$2) WHERE key=$1 AND period='0'", [reservation.key, refund]);
}

export async function refundQuota(res: Response, amount: number) {
  await refundReservation(res.locals?.growthQuota, amount);
}

/** This month's use of each counted feature, for the plan summary. */
export async function monthlyUsage(userId: number, ent: Entitlements) {
  const counted = (Object.keys(METERS) as MeteredFeature[]).filter((f) => METERS[f].limit);
  const locations = await billedLocationCount(userId);
  const { rows } = await pool.query("SELECT key,used FROM growth_budgets WHERE key=ANY($1::text[]) AND period='0'", [counted.map((f) => quotaKey(userId, f))]);
  const used = new Map(rows.map((r: any) => [r.key, Number(r.used)]));
  return Object.fromEntries(counted.map((f) => [f, { used: used.get(quotaKey(userId, f)) ?? 0, limit: monthlyLimit(ent, f, locations) }]));
}
