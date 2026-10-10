/**
 * What an account may do in the CRM — the CRM's own entitlements.
 *
 * The CRM is a separate product (owner, 2026-10-07): its seats and limits come
 * from the account's CRM subscription, never from a ConstructHUB platform plan.
 * A platform plan grants NO CRM access, and a CRM plan grants NO platform tools.
 *
 * The CRM subscription lives in its OWN table, `crm_subscriptions` (one row per
 * account), not in `subscriptions`: every platform billing path reads
 * `subscriptions` by user or by Stripe customer and assumes one row, so a second
 * row there could be picked up as the platform plan. Both products share the
 * account's Stripe customer; a CRM Stripe subscription carries
 * metadata.product = "crm" and CRM prices (server/billing/prices.ts), which is
 * how the webhook tells the two apart (server/crm/billing.ts).
 */
import { pool } from "../db";
import { ACCESS_STATUSES } from "../../shared/plans";
import {
  CRM_PLANS, isCrmPlanKey, CRM_EXTRA_SEAT_MONTHLY_CENTS, crmAddonAvailableOn, crmPlanHasJobcam,
  type CrmPlanKey, type CrmPlanLimits,
} from "../../shared/crm-plans";
import { isPlatformAdminEmail } from "../admin";

/** Idempotent, additive. Run once per process before anything reads the table. */
export const CRM_SUBSCRIPTION_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS crm_subscriptions (
     id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
     user_id integer NOT NULL UNIQUE,
     stripe_customer_id text,
     stripe_subscription_id text,
     stripe_price_id text,
     plan text,
     status text NOT NULL DEFAULT 'inactive',
     billing_interval text,
     extra_seats integer NOT NULL DEFAULT 0,
     current_period_end timestamp,
     trial_end timestamp,
     cancel_at_period_end boolean,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS crm_subscriptions_stripe_sub_idx ON crm_subscriptions (stripe_subscription_id)`,
  // The JobCam add-on (shared/crm-plans.ts CRM_ADDONS.jobcam): a yes/no line on the CRM subscription.
  `ALTER TABLE crm_subscriptions ADD COLUMN IF NOT EXISTS jobcam_addon boolean NOT NULL DEFAULT false`,
];

let schemaReady: Promise<void> | null = null;
export function crmBillingSchemaReady(): Promise<void> {
  schemaReady ??= (async () => {
    for (const ddl of CRM_SUBSCRIPTION_DDL) await pool.query(ddl);
  })().catch((e: any) => {
    console.error("[crm-billing] could not create crm_subscriptions:", e?.message || e);
    schemaReady = null;
  });
  return schemaReady;
}

export type CrmSubscriptionRow = {
  id: number;
  user_id: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  plan: string | null;
  status: string;
  billing_interval: string | null;
  extra_seats: number;
  jobcam_addon: boolean;
  current_period_end: Date | null;
  trial_end: Date | null;
  cancel_at_period_end: boolean | null;
};

export type CrmEntitlements = {
  /** The active CRM plan, or null when the account has no CRM subscription. */
  plan: CrmPlanKey | null;
  limits: CrmPlanLimits | null;
  /** Seats included by the plan plus Extra seats. 0 without a CRM plan; -1 = unlimited. */
  seats: number;
  extraSeats: number;
  /** The subscription carries the JobCam add-on (only counted on a plan that sells it). */
  jobcamAddon: boolean;
  /** JobCam is usable: the plan includes it, the add-on is on, or the account is beta / staff. */
  jobcam: boolean;
  status: string | null;
  /** True when the CRM is usable right now. */
  active: boolean;
  /** Why it is usable: a paid/trialing CRM plan, a beta account, or ConstructHUB staff. */
  via: "plan" | "beta" | "admin" | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
};

export const NO_CRM: CrmEntitlements = {
  plan: null, limits: null, seats: 0, extraSeats: 0, jobcamAddon: false, jobcam: false, status: null, active: false, via: null,
  trialEndsAt: null, currentPeriodEnd: null,
};

/** The account's CRM subscription row, or undefined. */
export async function crmSubscriptionRow(userId: number): Promise<CrmSubscriptionRow | undefined> {
  await crmBillingSchemaReady();
  const { rows: [row] } = await pool.query(`SELECT * FROM crm_subscriptions WHERE user_id = $1 LIMIT 1`, [userId]);
  return row;
}

// requireOrg() asks on every CRM request, so the answer is cached briefly per
// account; every write to crm_subscriptions forgets it (forgetCrmEntitlements).
const TTL_MS = 30_000;
const cache = new Map<number, { at: number; ent: CrmEntitlements }>();
export function forgetCrmEntitlements(userId?: number | null) {
  if (userId) cache.delete(userId); else cache.clear();
}

export async function getCrmEntitlements(userId: number | null | undefined, opts: { fresh?: boolean } = {}): Promise<CrmEntitlements> {
  if (!userId) return NO_CRM;
  const hit = cache.get(userId);
  if (hit && !opts.fresh && Date.now() - hit.at < TTL_MS) return hit.ent;
  const ent = await loadCrmEntitlements(userId);
  cache.set(userId, { at: Date.now(), ent });
  return ent;
}

async function loadCrmEntitlements(userId: number): Promise<CrmEntitlements> {
  await crmBillingSchemaReady();
  const { rows: [row] } = await pool.query(
    `SELECT u.email, u.beta_at, s.plan, s.status, s.extra_seats, s.jobcam_addon, s.trial_end, s.current_period_end
       FROM users u LEFT JOIN crm_subscriptions s ON s.user_id = u.id
      WHERE u.id = $1`, [userId]);
  if (!row) return NO_CRM;
  return crmEntitlementsFromRow(row, isPlatformAdminEmail(row.email));
}

/** The entitlements one users ⟕ crm_subscriptions row gives. Pure — crm-plans.test.ts checks it. */
export function crmEntitlementsFromRow(
  row: { beta_at?: Date | string | null; plan?: unknown; status?: string | null; extra_seats?: number | null; jobcam_addon?: boolean | null; trial_end?: Date | string | null; current_period_end?: Date | string | null },
  isAdmin: boolean,
): CrmEntitlements {
  // ConstructHUB staff and beta accounts use the CRM without a subscription.
  const top = CRM_PLANS.crm_elite;
  if (isAdmin) {
    return { ...NO_CRM, plan: "crm_elite", limits: top.limits, seats: -1, jobcam: true, status: row.status ?? null, active: true, via: "admin" };
  }
  if (row.beta_at) {
    return { ...NO_CRM, plan: "crm_elite", limits: top.limits, seats: -1, jobcam: true, status: row.status ?? null, active: true, via: "beta" };
  }
  const status: string | null = row.status ?? null;
  const live = !!status && (ACCESS_STATUSES as readonly string[]).includes(status);
  const storedPlan: unknown = row.plan;
  const plan: CrmPlanKey | null = live && isCrmPlanKey(storedPlan) ? storedPlan : null;
  if (!plan) return { ...NO_CRM, status };
  const limits = CRM_PLANS[plan].limits;
  const extraSeats = Math.max(0, Number(row.extra_seats) || 0);
  // The add-on only counts on a plan that sells it; a plan that includes JobCam needs none.
  const jobcamAddon = row.jobcam_addon === true && crmAddonAvailableOn("jobcam", plan);
  return {
    plan, limits, extraSeats, jobcamAddon, jobcam: crmPlanHasJobcam(plan, jobcamAddon), status, active: true, via: "plan",
    seats: limits.seats < 0 ? limits.seats : limits.seats + extraSeats,
    trialEndsAt: status === "trialing" && row.trial_end ? new Date(row.trial_end) : null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
  };
}

/** Price of one more CRM seat, for upgrade copy. */
export const crmExtraSeatCents = () => CRM_EXTRA_SEAT_MONTHLY_CENTS;

/** The body of the 402 a CRM route answers when the org's owner has no CRM plan. */
export function crmPlanRequiredBody() {
  const cheapest = CRM_PLANS.crm_basic;
  return {
    code: "crm_plan_required",
    message: `The ConstructHUB CRM is its own subscription, separate from the ConstructHUB platform plans, from $${(cheapest.monthlyCents / 100).toFixed(0)}/mo. Choose a CRM plan to open it.`,
    href: "/pricing#crm",
  };
}
