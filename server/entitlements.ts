/**
 * What a user's plan (plus add-ons) entitles them to — every server-side plan
 * check goes through here. The price book itself lives in shared/plans.ts.
 *
 *   getEntitlements(userId)       -> { plan, limits, modules, addons }
 *   requireModule(module)         -> Express middleware: 402 unless the plan includes it
 *   sendPlanRequired(res, ...)    -> the one 402 body the client understands
 *
 * Platform admins get every module (so the owner can run the product); they do
 * not get unlimited quotas beyond the top plan.
 */
import type { Request, Response, NextFunction } from "express";
import { pool } from "./db";
import { isPlatformAdminEmail } from "./admin";
import {
  PLANS, effectivePlanKey, planForModule, MODULE_NAMES,
  type PlanKey, type PlanLimits, type ModuleKey, type PlanModules, type AddonKey,
} from "@shared/plans";

export type Entitlements = {
  plan: PlanKey | null;
  /** Stored plan key as sold (may be a legacy key like "platinum"). */
  storedPlan: string | null;
  limits: PlanLimits | null;
  modules: PlanModules;
  addons: Partial<Record<AddonKey, number>>;
  isPlatformAdmin: boolean;
};

const ALL_MODULES: PlanModules = { agencyWorkspace: true, adsManager: true, cloudflareSearchConsole: true, domainsMailAlerts: true };
const NO_MODULES: PlanModules = { agencyWorkspace: false, adsManager: false, cloudflareSearchConsole: false, domainsMailAlerts: false };

export async function getEntitlements(userId: number): Promise<Entitlements> {
  const { rows: [row] } = await pool.query(
    `SELECT u.email, s.plan, s.status, s.addons
       FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
      WHERE u.id = $1 LIMIT 1`, [userId]).catch(async (e: any) => {
    // Before the billing lane adds subscriptions.addons, read without it.
    if (!/addons/.test(String(e?.message))) throw e;
    return pool.query(`SELECT u.email, s.plan, s.status FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.id = $1 LIMIT 1`, [userId]);
  });
  const admin = isPlatformAdminEmail(row?.email);
  const plan = effectivePlanKey(row);
  const addons = (row?.addons && typeof row.addons === "object") ? row.addons as Partial<Record<AddonKey, number>> : {};
  return {
    plan,
    storedPlan: row?.plan ?? null,
    limits: plan ? PLANS[plan].limits : null,
    modules: admin ? ALL_MODULES : plan ? PLANS[plan].modules : NO_MODULES,
    addons,
    isPlatformAdmin: admin,
  };
}

/** The single 402 body for "your plan doesn't include this". */
export function sendPlanRequired(res: Response, requiredPlan: PlanKey, what: string) {
  const name = PLANS[requiredPlan].name;
  return res.status(402).json({
    code: "plan_required",
    requiredPlan,
    message: `${what} is included with the ${name} plan. Upgrade in Pricing to use it.`,
  });
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
