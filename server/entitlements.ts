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
 * Platform admins (server/admin.ts ADMIN_EMAILS — the Alpine account) are
 * all-access, owner 2026-10-02: every module and every add-on module, and every
 * numeric usage limit unlimited (-1, the price book's convention —
 * platformAdminAllowances). The AI Call Assistant keeps a ceiling on numbers
 * (ADMIN_CALL_ASSISTANT_NUMBERS: each one is a real carrier number) with
 * unlimited minutes. Nothing here changes for any other account.
 *
 * A subscription row without a Stripe subscription is a grant (a trial code, or
 * a manual grant). It stops counting once its current_period_end has passed; a
 * grant with no end date stays open until an admin ends it. Stripe-managed rows
 * follow their Stripe status only (the webhook keeps it current): active and
 * trialing have access — ACCESS_STATUSES in shared/plans.ts. past_due (Stripe
 * still retrying the card) has NO plan access: the plan pauses until the
 * payment goes through, the same rule as the add-on modules below.
 *
 * Add-on MODULES (the AI Call Assistant) are stricter: they run only while the
 * subscription is active or trialing (ADDON_MODULE_RUN_STATUSES). Owner,
 * 2026-10-02: "As soon as they stop paying the agent stops working." On a
 * payment-needed status (past_due, unpaid, incomplete, paused) the module is
 * off and `addonModulesPaused` says why, so the CRM can say "update your
 * payment method" instead of "buy the add-on".
 */
import type { Request, Response, NextFunction } from "express";
import { pool } from "./db";
import { isPlatformAdminEmail } from "./admin";
import { forgetDashboard } from "./dashboard/cache";
import {
  PLANS, PLAN_KEYS, ADDONS, AGENCY_SELF_SERVE_MAX_LOCATIONS, ACCESS_STATUSES, effectivePlanKey, planForModule, MODULE_NAMES,
  ADDON_MODULES, isAddonModule, moduleName, ADDON_MODULE_UNLOCKED_BY, callAssistantIncluded,
  ADDON_MODULE_RUN_STATUSES, PAYMENT_NEEDED_STATUSES, storedPlanKey, UNLIMITED,
  type PlanKey, type PlanLimits, type ModuleKey, type PlanModules, type AddonKey, type CountLimitKey,
  type AddonModuleKey, type AnyModuleKey,
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
  /**
   * limits plus purchased add-ons sold on that plan: what every gate checks.
   * For platform admins, platformAdminAllowances() (every usage limit -1).
   */
  allowances: PlanLimits | null;
  modules: PlanModules;
  /**
   * Modules an add-on unlocks (shared/plans.ts ADDON_MODULES): on when the
   * add-on is on the subscription, the plan sells it and the subscription is
   * active or trialing (ADDON_MODULE_RUN_STATUSES — never past_due). Platform
   * admins get them all, like the plan modules.
   */
  addonModules: Record<AddonModuleKey, boolean>;
  /**
   * An add-on module that is bought but off because a payment is needed
   * (PAYMENT_NEEDED_STATUSES): the CRM shows "Paused — update your payment
   * method", reads stay open, edits and the engine are refused. Never a gate
   * that grants anything.
   */
  addonModulesPaused: Record<AddonModuleKey, boolean>;
  addons: Partial<Record<AddonKey, number>>;
  /**
   * Add-on quantities on the stored row whatever its status (a paused add-on
   * keeps its numbers on display). Display only — every gate reads `addons`.
   */
  storedAddons: Partial<Record<AddonKey, number>>;
  /** The deciding subscription row's status (null without one). */
  subscriptionStatus: string | null;
  isPlatformAdmin: boolean;
  /** End of a Stripe-less grant (trial code); null for Stripe-managed or open-ended rows. */
  grantEndsAt: Date | null;
};

const ALL_MODULES: PlanModules = { agencyWorkspace: true, adsManager: true, cloudflareSearchConsole: true, domainsMailAlerts: true };
const NO_MODULES: PlanModules = { agencyWorkspace: false, adsManager: false, cloudflareSearchConsole: false, domainsMailAlerts: false };
const ADDON_MODULE_KEYS = Object.keys(ADDON_MODULES) as AddonModuleKey[];

/**
 * Which add-on modules a plan + add-on set unlocks under a subscription status
 * (every one for platform admins). The status is required: an add-on module
 * runs only while the subscription is active or trialing.
 */
export function addonModulesFor(plan: PlanKey | null, addons: Partial<Record<AddonKey, number>>, status: string | null | undefined, admin = false): Record<AddonModuleKey, boolean> {
  const out = {} as Record<AddonModuleKey, boolean>;
  const running = ADDON_MODULE_RUN_STATUSES.includes(status ?? "");
  for (const key of ADDON_MODULE_KEYS) {
    out[key] = admin || (running && !!plan && ADDON_MODULE_UNLOCKED_BY[key].some((addon) => (addons[addon] ?? 0) > 0 && ADDONS[addon].availableOn.includes(plan)));
  }
  return out;
}

/**
 * Add-on modules that are bought but paused for a payment: the stored row
 * carries the add-on on a plan that sells it, and its status says a payment is
 * needed (past_due, unpaid, incomplete, paused). Never for platform admins
 * (their modules are on) and never for an ended subscription (that is "not
 * subscribed", not "paused").
 */
export function addonModulesPausedFor(storedPlan: string | null | undefined, storedAddons: Partial<Record<AddonKey, number>>, status: string | null | undefined, admin = false): Record<AddonModuleKey, boolean> {
  const out = {} as Record<AddonModuleKey, boolean>;
  const plan = storedPlanKey(storedPlan);
  const needsPayment = PAYMENT_NEEDED_STATUSES.includes(status ?? "");
  for (const key of ADDON_MODULE_KEYS) {
    out[key] = !admin && needsPayment && !!plan && ADDON_MODULE_UNLOCKED_BY[key].some((addon) => (storedAddons[addon] ?? 0) > 0 && ADDONS[addon].availableOn.includes(plan));
  }
  return out;
}

/** Is a plan-level or add-on module on for these entitlements? */
export function moduleEnabled(ent: Pick<Entitlements, "modules" | "addonModules">, module: AnyModuleKey): boolean {
  return isAddonModule(module) ? ent.addonModules[module] : ent.modules[module];
}

/**
 * The Call Assistant allowance the subscription buys: numbers = the held
 * tier's numbers (shared/plans.ts CALL_ASSISTANT_TIERS) plus every call_number
 * unit; minutes per month = the tier's included minutes; overageCentsPerMinute
 * = the tier's own overage rate (0 with no allowance: the meter then keeps the
 * month's snapshot). Platform admins get unlimited minutes (-1: never overage)
 * and up to ADMIN_CALL_ASSISTANT_NUMBERS numbers (or what their tier holds, if
 * more) — a ceiling, because every number is a real carrier number; their rate
 * is their tier's, or Solo's with none (moot while minutes are unlimited).
 */
export function callAssistantAllowance(ent: Pick<Entitlements, "addonModules" | "addons" | "isPlatformAdmin"> & Partial<Pick<Entitlements, "addonModulesPaused" | "storedAddons">>): { numbers: number; minutes: number; overageCentsPerMinute: number } {
  // A paused add-on (payment needed) still shows what it bought: its numbers are held, not released.
  const paused = !ent.addonModules.callAssistant && ent.addonModulesPaused?.callAssistant === true;
  if (!ent.addonModules.callAssistant && !paused) return { numbers: 0, minutes: 0, overageCentsPerMinute: 0 };
  const addons = paused ? ent.storedAddons ?? {} : ent.addons;
  const included = callAssistantIncluded(addons);
  const bought = included.numbers + (addons.call_number ?? 0);
  if (ent.isPlatformAdmin) return { numbers: Math.max(ADMIN_CALL_ASSISTANT_NUMBERS, bought), minutes: UNLIMITED, overageCentsPerMinute: included.overageCentsPerMinute };
  return { numbers: bought, minutes: included.minutes, overageCentsPerMinute: included.overageCentsPerMinute };
}

/**
 * Call Assistant numbers a platform admin may hold: an engineering safeguard (each one is a
 * real carrier number that costs money), not an owner rule. Confirm the number with the owner.
 */
export const ADMIN_CALL_ASSISTANT_NUMBERS = 5;

/** The most complete plan: what platform admins run with. */
export const TOP_PLAN: PlanKey = PLAN_KEYS[PLAN_KEYS.length - 1];
/** The plan billed per location through AGENCY_LOCATION_BANDS, self-serve up to AGENCY_SELF_SERVE_MAX_LOCATIONS. */
export const PER_LOCATION_PLAN: PlanKey = "agency";

/**
 * Numeric PlanLimits that are not usage caps, so they are not made unlimited
 * for platform admins: Profile Guard's check cadence (admins get the fastest any
 * plan buys), the public API's requests per minute per key (a rate, kept from
 * the top plan), and the per-location multipliers (moot once the monthly base
 * is unlimited, so 0).
 */
export const ADMIN_NON_CAP_LIMITS = ["guardCadenceMinutes", "apiRatePerMinute", "gridCreditsPerLocation", "siteScansPerLocation"] as const satisfies readonly CountLimitKey[];

/**
 * What a platform admin runs with: the top plan's limits with every numeric
 * usage limit unlimited (-1) — monthly quotas (searches, grid credits, Site
 * Scans, Competitor scans, texts, API units) and counts (locations, protected
 * sites, seats, review templates) — automatic AI reply publishing, and the
 * fastest Profile Guard cadence. Built from PlanLimits' own keys, so a limit
 * added to the price book later is unlimited for admins by default.
 */
export function platformAdminAllowances(): PlanLimits {
  const out: PlanLimits = { ...PLANS[TOP_PLAN].limits };
  const skip = new Set<string>(ADMIN_NON_CAP_LIMITS);
  for (const key of Object.keys(out) as (keyof PlanLimits)[]) {
    if (typeof out[key] === "number" && !skip.has(key)) (out as Record<string, unknown>)[key] = UNLIMITED;
  }
  out.gridCreditsPerLocation = 0;
  out.siteScansPerLocation = 0;
  out.guardCadenceMinutes = Math.min(...PLAN_KEYS.map((k) => PLANS[k].limits.guardCadenceMinutes));
  out.autoPublishAiReplies = true;
  return out;
}

/** Numeric limits an add-on can raise. */
export type CountLimit = CountLimitKey;

/**
 * What one unit of each add-on adds to the plan's limits: the price book's own
 * `grants` (shared/plans.ts), so the two can't drift. The texting number is a
 * carrier number, not a count limit: the texting gate is the plan's.
 */
export const ADDON_GRANTS: Record<AddonKey, Partial<Record<CountLimit, number>>> = Object.fromEntries(
  (Object.keys(ADDONS) as AddonKey[]).map((key) => [key, ADDONS[key].grants]),
) as Record<AddonKey, Partial<Record<CountLimit, number>>>;

/**
 * The subscription row that decides an account's plan: one row per account is
 * the norm; if there are several, one with access wins, then the newest.
 * `$1` is the user id (or ids, with ANY), `$2` ACCESS_STATUSES.
 */
export const SUBSCRIPTION_ORDER = "ORDER BY (x.status = ANY($2::text[])) DESC, x.id DESC LIMIT 1";

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

/**
 * The account's email and its deciding subscription row (SUBSCRIPTION_ORDER;
 * every column, the billing ones included), or undefined for an unknown user.
 * A user without a subscription row comes back with the subscription columns null.
 */
export async function accountSubscriptionRow(userId: number): Promise<(SubscriptionRow & { email?: string | null; addons?: unknown; id?: number | null }) | undefined> {
  const { rows: [row] } = await pool.query(
    `SELECT u.email, s.* FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM subscriptions x WHERE x.user_id = u.id AND x.product = 'platform' ${SUBSCRIPTION_ORDER}
       ) s ON true
      WHERE u.id = $1`, [userId, ACCESS_STATUSES]);
  return row;
}

export async function getEntitlements(userId: number, now = new Date()): Promise<Entitlements> {
  // s.* includes subscriptions.addons (the billing columns).
  const row = await accountSubscriptionRow(userId);
  const admin = isPlatformAdminEmail(row?.email);
  const plan = activePlanKey(row, now);
  const accessPlan = admin ? TOP_PLAN : plan;
  const storedAddons = parseAddons(row?.addons);
  const addons = plan ? storedAddons : {};
  const status = row?.status ?? null;
  const grantEnd = row && !row.stripe_subscription_id && row.current_period_end ? new Date(row.current_period_end) : null;
  return {
    plan,
    storedPlan: row?.plan ?? null,
    accessPlan,
    limits: accessPlan ? PLANS[accessPlan].limits : null,
    allowances: admin ? platformAdminAllowances() : accessPlan ? allowancesFor(accessPlan, addons) : null,
    modules: admin ? ALL_MODULES : plan ? PLANS[plan].modules : NO_MODULES,
    addonModules: addonModulesFor(plan, addons, status, admin),
    addonModulesPaused: addonModulesPausedFor(grantExpired(row, now) ? null : row?.plan, storedAddons, status, admin),
    addons,
    storedAddons,
    subscriptionStatus: status,
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

/**
 * Locations a per-location plan is billed for: linked Google Business Profile
 * listings, a listing linked twice counting once (the same count the Agency
 * billing sync sends to Stripe). Places-only rows count toward the location
 * limit but are not billed, so they earn no per-location allowance.
 */
export async function billedLocationCount(userId: number): Promise<number> {
  const { rows: [r] } = await pool.query(
    "SELECT count(DISTINCT gbp_location_name)::int n FROM business_locations WHERE user_id=$1 AND gbp_location_name IS NOT NULL", [userId]);
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
/**
 * A Stripe subscription that is not over (paying, trialing, or waiting on a
 * payment): a trial code or an admin grant must never replace it.
 */
export function liveStripeSubscription(sub: { stripe_subscription_id?: string | null; status?: string | null } | null | undefined): boolean {
  return !!sub?.stripe_subscription_id && !STRIPE_ENDED.has(sub.status ?? "");
}
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
      `SELECT * FROM subscriptions x WHERE x.user_id=$1 ${SUBSCRIPTION_ORDER}`, [userId, ACCESS_STATUSES]);
    const refuse = async (refused: string, status: 400 | 409) => { await c.query("ROLLBACK"); return { refused, status }; };
    if (liveStripeSubscription(sub)) {
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
      // An ended Stripe subscription's ids go with it (the customer id stays for a
      // later checkout), and so do its add-ons, interval and billed locations:
      // the trial grants the plan as published, not what the old subscription bought.
      await c.query(
        `UPDATE subscriptions SET plan=$2, status='trialing', current_period_end=$3, stripe_subscription_id=NULL, stripe_price_id=NULL,
                addons='{}'::jsonb, billing_interval=NULL, agency_locations=NULL WHERE id=$1`,
        [sub.id, TRIAL_CODE_PLAN, end]);
    } else {
      await c.query("INSERT INTO subscriptions(user_id, plan, status, current_period_end) VALUES ($1, $2, 'trialing', $3)", [userId, TRIAL_CODE_PLAN, end]);
    }
    await c.query("COMMIT");
    forgetDashboard(userId);
    return { trialEnd: end, unlimited };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** When a redeemed code's own trial window ends (trialDays 0 = until revoked). */
function codeTrialEnd(code: { redeemedAt: Date | string | null; trialDays: number }): Date | null {
  if (code.trialDays === 0) return OPEN_ENDED_TRIAL;
  if (!code.redeemedAt) return null;
  return new Date(new Date(code.redeemedAt).getTime() + code.trialDays * 86400_000);
}
/** Slack between a code's redeemed_at and the end date written for it (older redemptions set them apart). */
const TRIAL_END_SLACK_MS = 60_000;

/**
 * After an admin revokes a redeemed trial code: end the trial that code is
 * keeping alive, and nothing else. Only a Stripe-less grant with an end date is
 * touched (never a paid plan or an open-ended grant). A code whose own window
 * has already ended, or whose window is shorter than the grant's end date (the
 * grant was extended by something else), leaves the grant alone. If another
 * live code still covers the account, the grant is cut back to that code's end
 * instead of ending.
 */
export async function endRevokedTrial(code: { id: number; redeemedByUserId: number | null; redeemedAt: Date | string | null; trialDays: number }, now = new Date()): Promise<"ended" | "shortened" | "unchanged"> {
  const userId = code.redeemedByUserId;
  const ownEnd = codeTrialEnd(code);
  if (!userId || !ownEnd || ownEnd <= now) return "unchanged";
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(7170, $1)", [userId]);
    const { rows: [sub] } = await c.query(
      `SELECT * FROM subscriptions x WHERE x.user_id=$1 ${SUBSCRIPTION_ORDER}`, [userId, ACCESS_STATUSES]);
    const grantEnd = sub && !sub.stripe_subscription_id && sub.current_period_end != null && ["trialing", "active"].includes(sub.status)
      ? new Date(sub.current_period_end) : null;
    if (!grantEnd || grantEnd <= now || grantEnd.getTime() > ownEnd.getTime() + TRIAL_END_SLACK_MS
        || await adminGrantHolds(c, sub, now)) {
      await c.query("ROLLBACK");
      return "unchanged";
    }
    const { rows: others } = await c.query(
      "SELECT redeemed_at, trial_days FROM beta_access_codes WHERE redeemed_by_user_id=$1 AND id<>$2 AND NOT revoked",
      [userId, code.id]);
    const stillCovered = others
      .map((o: any) => codeTrialEnd({ redeemedAt: o.redeemed_at, trialDays: o.trial_days }))
      .filter((d: Date | null): d is Date => !!d && d > now)
      .reduce<Date | null>((a, b) => (!a || b > a ? b : a), null);
    let outcome: "ended" | "shortened" | "unchanged" = "unchanged";
    if (!stillCovered) {
      await c.query("UPDATE subscriptions SET status='canceled', current_period_end=$2 WHERE id=$1", [sub.id, now]);
      outcome = "ended";
    } else if (stillCovered < grantEnd) {
      await c.query("UPDATE subscriptions SET current_period_end=$2 WHERE id=$1", [sub.id, stillCovered]);
      outcome = "shortened";
    }
    await c.query("COMMIT");
    if (outcome !== "unchanged") forgetDashboard(userId);
    return outcome;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Is this subscription row the one a live admin access grant wrote
 * (server/access-grants.ts)? Then it is the admin's grant, not a trial code's
 * trial, and revoking a code leaves it alone. False where the grants table
 * does not exist yet.
 */
async function adminGrantHolds(c: { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }, sub: { id: number; plan: string; current_period_end: Date | string }, now: Date): Promise<boolean> {
  const { rows: [t] } = await c.query("SELECT to_regclass('admin_access_grants') IS NOT NULL AS present");
  if (!t?.present) return false;
  const { rows: [g] } = await c.query(
    `SELECT 1 FROM admin_access_grants WHERE subscription_id=$1 AND plan=$2 AND revoked_at IS NULL AND replaced_at IS NULL
        AND ends_at > $3 AND abs(extract(epoch FROM ends_at - $4::timestamptz)) < 1 LIMIT 1`,
    [sub.id, sub.plan, now, new Date(sub.current_period_end)]);
  return !!g;
}

/** Does the account's plan (or platform-admin access, or a purchased add-on) include this module? */
export async function hasModule(userId: number, module: AnyModuleKey): Promise<boolean> {
  return moduleEnabled(await getEntitlements(userId), module);
}

/**
 * Of these accounts, the ones whose plan (or platform-admin access) includes
 * the module — one query for a whole batch, for schedulers that would
 * otherwise call getEntitlements once per owner. Same rules as getEntitlements:
 * the deciding subscription row, legacy keys mapped, expired grants dropped.
 */
export async function usersWithModule(userIds: readonly number[], module: ModuleKey, now = new Date()): Promise<Set<number>> {
  const ids = [...new Set(userIds.filter((id) => Number.isSafeInteger(id)))];
  const out = new Set<number>();
  if (!ids.length) return out;
  const { rows } = await pool.query(
    `SELECT u.id AS account_id, u.email, s.plan, s.status, s.stripe_subscription_id, s.current_period_end FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM subscriptions x WHERE x.user_id = u.id ${SUBSCRIPTION_ORDER}
       ) s ON true
      WHERE u.id = ANY($1::int[])`, [ids, ACCESS_STATUSES]);
  for (const row of rows) {
    const plan = activePlanKey(row, now);
    if (isPlatformAdminEmail(row.email) || (plan && PLANS[plan].modules[module])) out.add(Number(row.account_id));
  }
  return out;
}

/** The note a worker records when it skips a job because the owner's plan lacks the module. */
export const planPausedMessage = (module: ModuleKey) =>
  `Not run: ${MODULE_NAMES[module]} is included with the ${PLANS[planForModule(module)].name} plan.`;

/**
 * The 402 for a module the account lacks. A plan module names the plan that
 * includes it; an add-on module names the add-on and where to buy it (the
 * body carries `addon` so the client can link Settings → Billing).
 */
export function sendModuleRequired(res: Response, module: AnyModuleKey) {
  if (!isAddonModule(module)) return sendPlanRequired(res, planForModule(module), MODULE_NAMES[module]);
  const addon = ADDON_MODULES[module];
  const on = ADDONS[addon].availableOn.map((k) => PLANS[k].name);
  const plans = on.length > 1 ? `${on.slice(0, -1).join(", ")} and ${on[on.length - 1]}` : on[0] ?? "";
  return sendPlanRequired(res, planForModule(module), moduleName(module), {
    addon,
    message: `${moduleName(module)} is an add-on for the ${plans} plans. Add it in Settings → Billing to use it.`,
  });
}

/** `code` on the 402 for a bought add-on module that is paused until a payment goes through. */
export const PAYMENT_REQUIRED_CODE = "payment_required";
/** Where the client sends the owner to fix the card. */
export const BILLING_HREF = "/settings?tab=billing";

/** Is this add-on module bought but paused for a payment? */
export function modulePaused(ent: Pick<Entitlements, "addonModules"> & Partial<Pick<Entitlements, "addonModulesPaused">>, module: AnyModuleKey): boolean {
  return isAddonModule(module) && !ent.addonModules[module] && ent.addonModulesPaused?.[module] === true;
}

/**
 * The 402 for a bought add-on module paused by a failed or missing payment:
 * not "buy it" — "update your payment method". The body carries `addon` and
 * `billingHref` so the client can link Settings → Billing.
 */
export function sendModulePaymentNeeded(res: Response, module: AddonModuleKey) {
  return res.status(402).json({
    code: PAYMENT_REQUIRED_CODE,
    addon: ADDON_MODULES[module],
    billingHref: BILLING_HREF,
    message: `${moduleName(module)} is paused because the subscription's payment didn't go through. Update your payment method in Settings → Billing and it starts working again.`,
  });
}

/** Express middleware for a whole module's routes. Expects req.user (session auth). */
export function requireModule(module: AnyModuleKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user?.id) return res.status(401).json({ message: "Not authenticated" });
    try {
      const ent = await getEntitlements(user.id);
      if (moduleEnabled(ent, module)) return next();
      if (isAddonModule(module) && modulePaused(ent, module)) return sendModulePaymentNeeded(res, module);
      return sendModuleRequired(res, module);
    } catch (e) {
      next(e);
    }
  };
}
