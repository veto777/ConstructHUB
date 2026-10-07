/**
 * What an account may do in the CRM — the CRM's own entitlements.
 *
 * The CRM is a separate product (owner, 2026-10-07): its seats and limits come
 * from the account's CRM subscription, never from a ConstructHUB platform plan.
 * A platform plan grants NO CRM access, and a CRM plan grants NO platform tools.
 *
 * Both products live in `subscriptions`, one row each, told apart by the
 * `product` column ('platform' | 'crm'; server/billing/schema.ts adds it, default
 * 'platform' so every pre-split row stays a platform row). The platform's
 * getEntitlements() reads product='platform'; this reads product='crm'.
 */
import { pool } from "../db";
import { ACCESS_STATUSES } from "../../shared/plans";
import {
  CRM_PLANS, isCrmPlanKey, CRM_EXTRA_SEAT_MONTHLY_CENTS,
  type CrmPlanKey, type CrmPlanLimits,
} from "../../shared/crm-plans";

/** The add-on key for one more CRM seat, stored in the CRM row's `addons`. */
export const CRM_EXTRA_SEAT_ADDON = "crm_extra_seat";

export type CrmEntitlements = {
  /** The active CRM plan, or null when the account has no CRM subscription. */
  plan: CrmPlanKey | null;
  limits: CrmPlanLimits | null;
  /** Seats included by the plan plus any Extra seat add-ons. 0 without a CRM plan. */
  seats: number;
  extraSeats: number;
  status: string | null;
  /** True when the CRM is usable right now. */
  active: boolean;
};

export const NO_CRM: CrmEntitlements = {
  plan: null, limits: null, seats: 0, extraSeats: 0, status: null, active: false,
};

function parseAddons(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
  }
  return out;
}

/** The account's CRM subscription row, or undefined. */
export async function crmSubscriptionRow(userId: number): Promise<any | undefined> {
  const { rows: [row] } = await pool.query(
    `SELECT * FROM subscriptions x
       WHERE x.user_id = $1 AND x.product = 'crm'
       ORDER BY (x.status = ANY($2::text[])) DESC, x.id DESC
       LIMIT 1`,
    [userId, ACCESS_STATUSES],
  );
  return row;
}

export async function getCrmEntitlements(userId: number | null | undefined): Promise<CrmEntitlements> {
  if (!userId) return NO_CRM;
  const row = await crmSubscriptionRow(userId);
  if (!row) return NO_CRM;
  const status = row.status ?? null;
  const active = !!status && (ACCESS_STATUSES as readonly string[]).includes(status);
  const storedPlan: unknown = row.plan;
  const plan: CrmPlanKey | null = active && isCrmPlanKey(storedPlan) ? storedPlan : null;
  if (!plan) return { ...NO_CRM, status };
  const limits = CRM_PLANS[plan].limits;
  const extraSeats = parseAddons(row.addons)[CRM_EXTRA_SEAT_ADDON] ?? 0;
  const seats = limits.seats < 0 ? limits.seats : limits.seats + extraSeats;
  return { plan, limits, seats, extraSeats, status, active: true };
}

/** Price of one more CRM seat, for upgrade copy. */
export const crmExtraSeatCents = () => CRM_EXTRA_SEAT_MONTHLY_CENTS;
