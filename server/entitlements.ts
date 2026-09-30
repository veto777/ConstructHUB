/**
 * What a user's plan (plus add-ons) entitles them to — every server-side plan
 * check goes through here. The price book itself lives in shared/plans.ts.
 *
 *   getEntitlements(userId)       -> { plan, accessPlan, limits, allowances, modules, addons }
 *   requireModule(module)         -> Express middleware: 402 unless the plan includes it
 *   requirePlan(res, userId, ...) -> route helper: 401/402 unless the plan includes a feature
 *   sendPlanRequired(res, ...)    -> the one 402 body the client understands
 *   sendLimitReached(res, ...)    -> the one 403 body for "you've used what your plan includes"
 *
 * Platform admins get every module and the top plan's limits (so the owner can
 * run the product); they do not get unlimited quotas beyond the top plan.
 *
 * A subscription row without a Stripe subscription is a grant (a trial code, or
 * a manual grant). It stops counting once its current_period_end has passed; a
 * grant with no end date stays open until an admin ends it. Stripe-managed rows
 * follow their Stripe status only (the webhook keeps it current).
 */
import type { Request, Response, NextFunction } from "express";
import { pool } from "./db";
import { isPlatformAdminEmail } from "./admin";
import {
  PLANS, PLAN_KEYS, ADDONS, AGENCY_SELF_SERVE_MAX_LOCATIONS, effectivePlanKey, planForModule, MODULE_NAMES,
  type PlanKey, type PlanLimits, type ModuleKey, type PlanModules, type AddonKey,
} from "@shared/plans";

export type Entitlements = {
  /** The account's own active plan (legacy keys mapped, expired grants dropped). */
  plan: PlanKey | null;
  /** Stored plan key as sold (may be a legacy key like "platinum"). */
  storedPlan: string | null;
  /** The plan whose limits apply: the account's plan, or the top plan for platform admins. */
  accessPlan: PlanKey | null;
  /** accessPlan's limits as published. */
  limits: PlanLimits | null;
  /** limits plus purchased add-ons sold on that plan: what every gate checks. */
  allowances: PlanLimits | null;
  modules: PlanModules;
  addons: Partial<Record<AddonKey, number>>;
  isPlatformAdmin: boolean;
  /** End of a Stripe-less grant (trial code); null for Stripe-managed or open-ended rows. */
  grantEndsAt: Date | null;
};

const ALL_MODULES: PlanModules = { agencyWorkspace: true, adsManager: true, cloudflareSearchConsole: true, domainsMailAlerts: true };
const NO_MODULES: PlanModules = { agencyWorkspace: false, adsManager: false, cloudflareSearchConsole: false, domainsMailAlerts: false };

/** The most complete plan: what platform admins run with. */
export const TOP_PLAN: PlanKey = PLAN_KEYS[PLAN_KEYS.length - 1];
/** The plan billed per location through AGENCY_LOCATION_BANDS, self-serve up to AGENCY_SELF_SERVE_MAX_LOCATIONS. */
export const PER_LOCATION_PLAN: PlanKey = "agency";

/** Numeric limits an add-on can raise. */
export type CountLimit = { [K in keyof PlanLimits]: PlanLimits[K] extends number ? K : never }[keyof PlanLimits];

/**
 * What one unit of each add-on adds to the plan's limits (matches ADDONS'
 * descriptions; server/entitlements.test.ts keeps the two in step). The texting
 * number is a carrier number, not a count limit: the texting gate is the plan's.
 */
export const ADDON_GRANTS: Record<AddonKey, Partial<Record<CountLimit, number>>> = {
  extra_location: { locations: 1 },
  extra_seat: { crmSeats: 1 },
  protected_site: { protectedSites: 1 },
  competitor_pack: { competitorScans: 10 },
  texting_number: {},
};

type SubscriptionRow = {
  plan?: string | null;
  status?: string | null;
  stripe_subscription_id?: string | null;
  current_period_end?: Date | string | null;
};

/** A Stripe-less grant (trial code) whose end date has passed. */
export function grantExpired(sub: SubscriptionRow | null | undefined, now = new Date()): boolean {
  if (!sub || sub.stripe_subscription_id || sub.current_period_end == null) return false;
  const end = new Date(sub.current_period_end).getTime();
  return Number.isFinite(end) && end <= now.getTime();
}

/** effectivePlanKey plus grant expiry: the plan a stored row entitles, or null. */
export function activePlanKey(sub: SubscriptionRow | null | undefined, now = new Date()): PlanKey | null {
  if (grantExpired(sub, now)) return null;
  return effectivePlanKey(sub);
}

/** Add-on quantities as stored ({ extra_seat: 2, ... }); anything else is ignored. */
export function parseAddons(raw: unknown): Partial<Record<AddonKey, number>> {
  const out: Partial<Record<AddonKey, number>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of Object.keys(ADDONS) as AddonKey[]) {
    const n = Number((raw as Record<string, unknown>)[key]);
    if (Number.isInteger(n) && n > 0) out[key] = n;
  }
  return out;
}

/** A plan's limits with the add-ons that plan sells applied. */
export function allowancesFor(plan: PlanKey, addons: Partial<Record<AddonKey, number>> = {}): PlanLimits {
  const out: PlanLimits = { ...PLANS[plan].limits };
  if (plan === PER_LOCATION_PLAN) out.locations = AGENCY_SELF_SERVE_MAX_LOCATIONS;
  for (const key of Object.keys(ADDON_GRANTS) as AddonKey[]) {
    const qty = addons[key] ?? 0;
    if (!qty || !ADDONS[key].availableOn.includes(plan)) continue;
    for (const [limit, per] of Object.entries(ADDON_GRANTS[key]) as [CountLimit, number][]) {
      if (out[limit] !== -1) out[limit] += per * qty;
    }
  }
  return out;
}

export async function getEntitlements(userId: number, now = new Date()): Promise<Entitlements> {
  // One subscription row per account is the norm; if there are several, an
  // active one wins. s.* also picks up subscriptions.addons once billing adds it.
  const { rows: [row] } = await pool.query(
    `SELECT u.email, s.* FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM subscriptions x WHERE x.user_id = u.id
          ORDER BY (x.status IN ('active','trialing')) DESC, x.id DESC LIMIT 1
       ) s ON true
      WHERE u.id = $1`, [userId]);
  const admin = isPlatformAdminEmail(row?.email);
  const plan = activePlanKey(row, now);
  const accessPlan = admin ? TOP_PLAN : plan;
  const addons = plan ? parseAddons(row?.addons) : {};
  const grantEnd = row && !row.stripe_subscription_id && row.current_period_end ? new Date(row.current_period_end) : null;
  return {
    plan,
    storedPlan: row?.plan ?? null,
    accessPlan,
    limits: accessPlan ? PLANS[accessPlan].limits : null,
    allowances: accessPlan ? allowancesFor(accessPlan, admin ? {} : addons) : null,
    modules: admin ? ALL_MODULES : plan ? PLANS[plan].modules : NO_MODULES,
    addons,
    isPlatformAdmin: admin,
    grantEndsAt: plan && grantEnd ? grantEnd : null,
  };
}

/** The cheapest plan whose limits pass `test` (for upgrade prompts). */
export function cheapestPlanWhere(test: (limits: PlanLimits) => boolean): PlanKey | null {
  return PLAN_KEYS.find((k) => test(PLANS[k].limits)) ?? null;
}

/** The first plan above `current` whose limits pass `test`. */
export function nextPlanWhere(current: PlanKey | null, test: (limits: PlanLimits) => boolean): PlanKey | null {
  const from = current ? PLAN_KEYS.indexOf(current) + 1 : 0;
  return PLAN_KEYS.slice(from).find((k) => test(PLANS[k].limits)) ?? null;
}

/** The single 402 body for "your plan doesn't include this". */
export function sendPlanRequired(res: Response, requiredPlan: PlanKey, what: string, extra: { message?: string } & Record<string, unknown> = {}) {
  const name = PLANS[requiredPlan].name;
  return res.status(402).json({
    code: "plan_required",
    requiredPlan,
    message: `${what} is included with the ${name} plan. Upgrade in Pricing to use it.`,
    ...extra,
  });
}

/** The single 403 body for "you've used what your plan includes". */
export function sendLimitReached(res: Response, body: { limit: number; used?: number; feature: string; message: string; upgradePlan?: PlanKey | null; addon?: AddonKey | null; resetsAt?: string }) {
  return res.status(403).json({ code: "limit_reached", ...body });
}

/** "1 location" / "3 locations". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * How to get more of a count limit: the add-on the plan sells for it, and the
 * next plan with a higher limit (with that plan's number).
 */
export function raiseHint(ent: Entitlements, key: CountLimit, unit: [string, string?], addon?: AddonKey): { text: string; upgradePlan: PlanKey | null; addon: AddonKey | null } {
  const current = ent.accessPlan;
  const own = current ? PLANS[current].limits[key] : 0;
  const upgradePlan = nextPlanWhere(current, (l) => l[key] === -1 || l[key] > own);
  const sellsAddon = !!addon && !!current && ADDONS[addon].availableOn.includes(current);
  const options: string[] = [];
  if (sellsAddon) options.push(`add the ${ADDONS[addon!].name} add-on`);
  if (upgradePlan) {
    const theirs = PLANS[upgradePlan].limits[key];
    options.push(`move to ${PLANS[upgradePlan].name}${theirs > 0 ? ` (${plural(theirs, ...unit)})` : ""}`);
  }
  const text = options.length ? `To raise it, ${options.join(" or ")}.` : "";
  return { text, upgradePlan, addon: sellsAddon ? addon! : null };
}

/**
 * Route helper: resolve the paying account's entitlements, or answer 401 (no
 * account) / 402 (no plan, or the plan lacks the feature). `test` defaults to
 * "has any paid plan".
 */
export async function requirePlan(res: Response, userId: number | null | undefined, what: string, test: (allowances: PlanLimits) => boolean = () => true): Promise<Entitlements | null> {
  if (!userId) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  const ent = await getEntitlements(userId);
  if (ent.allowances && test(ent.allowances)) return ent;
  sendPlanRequired(res, cheapestPlanWhere(test) ?? TOP_PLAN, what);
  return null;
}

/** Locations the account holds (Places-added and Business Profile-linked alike). */
export async function locationCount(userId: number, client: { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> } = pool): Promise<number> {
  const { rows: [r] } = await client.query("SELECT count(*)::int n FROM business_locations WHERE user_id=$1", [userId]);
  return r?.n ?? 0;
}

/** The 403 for a full location allowance. */
export function sendLocationLimit(res: Response, ent: Entitlements, used: number, adding = 1) {
  const limit = ent.allowances?.locations ?? 0;
  const plan = ent.accessPlan ? PLANS[ent.accessPlan].name : "current";
  const raise = ent.accessPlan === PER_LOCATION_PLAN
    ? { text: `Above ${plural(AGENCY_SELF_SERVE_MAX_LOCATIONS, "location")}, talk to a sales rep for a quote.`, upgradePlan: null, addon: null }
    : raiseHint(ent, "locations", ["location"], "extra_location");
  const wanted = adding > 1 ? ` You selected ${plural(adding, "new location")}.` : "";
  return sendLimitReached(res, {
    feature: "locations", limit, used,
    upgradePlan: raise.upgradePlan, addon: raise.addon,
    message: `Your ${plan} plan covers ${plural(limit, "Google Business Profile location")} and ${inUse(used)}.${wanted} ${raise.text}`.trim(),
  });
}

/** "1 is in use" / "3 are in use". */
export const inUse = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "is" : "are"} in use`;

/** The plan a trial code grants for its window. */
export const TRIAL_CODE_PLAN: PlanKey = "agency";
/** Stripe subscription statuses that have ended: the row may be replaced by a trial. */
const STRIPE_ENDED = new Set(["canceled", "incomplete_expired", "inactive"]);
const OPEN_ENDED_TRIAL = new Date("2099-12-31T23:59:59Z");

/**
 * Apply a redeemed trial code: TRIAL_CODE_PLAN until the trial ends, stored as
 * a Stripe-less grant with an end date (getEntitlements drops it after that).
 * Never replaces a paid Stripe subscription or an open-ended grant, never
 * shortens a live trial, and claims the code in the same transaction so one
 * code can't be spent twice. trialDays 0 is the admin's "until revoked" code.
 */
export async function redeemTrialCode(userId: number, code: { id: number; trialDays: number }, now = new Date()):
  Promise<{ trialEnd: Date; unlimited: boolean } | { refused: string; status: 400 | 409 }> {
  const unlimited = code.trialDays === 0;
  const trialEnd = unlimited ? OPEN_ENDED_TRIAL : new Date(now.getTime() + code.trialDays * 86400_000);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(7170, $1)", [userId]);
    const { rows: [sub] } = await c.query(
      "SELECT * FROM subscriptions WHERE user_id=$1 ORDER BY (status IN ('active','trialing')) DESC, id DESC LIMIT 1", [userId]);
    const refuse = async (refused: string, status: 400 | 409) => { await c.query("ROLLBACK"); return { refused, status }; };
    if (sub?.stripe_subscription_id && !STRIPE_ENDED.has(sub.status)) {
      return await refuse("Your account already has a paid plan, so a trial code can't be applied. Your plan stays as it is.", 409);
    }
    const liveGrant = !!sub && !sub.stripe_subscription_id && !!activePlanKey(sub, now);
    if (liveGrant && sub.current_period_end == null) {
      return await refuse("Your account already has full access with no end date, so this trial code isn't needed.", 409);
    }
    const { rowCount } = await c.query(
      "UPDATE beta_access_codes SET redeemed_by_user_id=$2, redeemed_at=$3 WHERE id=$1 AND redeemed_by_user_id IS NULL AND NOT revoked AND expires_at > $3",
      [code.id, userId, now]);
    if (!rowCount) return await refuse("This code has already been used.", 400);
    const currentEnd = liveGrant ? new Date(sub.current_period_end) : null;
    const end = currentEnd && currentEnd > trialEnd ? currentEnd : trialEnd;
    if (sub) {
      // An ended Stripe subscription's ids go with it (the customer id stays for a later checkout).
      await c.query(
        "UPDATE subscriptions SET plan=$2, status='trialing', current_period_end=$3, stripe_subscription_id=NULL, stripe_price_id=NULL WHERE id=$1",
        [sub.id, TRIAL_CODE_PLAN, end]);
    } else {
      await c.query("INSERT INTO subscriptions(user_id, plan, status, current_period_end) VALUES ($1, $2, 'trialing', $3)", [userId, TRIAL_CODE_PLAN, end]);
    }
    await c.query("COMMIT");
    return { trialEnd: end, unlimited };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Express middleware for a whole module's routes. Expects req.user (session auth). */
export function requireModule(module: ModuleKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user?.id) return res.status(401).json({ message: "Not authenticated" });
    try {
      const ent = await getEntitlements(user.id);
      if (ent.modules[module]) return next();
      return sendPlanRequired(res, planForModule(module), MODULE_NAMES[module]);
    } catch (e) {
      next(e);
    }
  };
}
