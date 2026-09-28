import type { Request, Response } from "express";
import { PLANS } from "./stripe";
import { pool } from "./db";
import { actorKey, takeBudget } from "./growth-limits";
export type MeteredFeature = "photos" | "searches" | "rankings";
export function planLimit(plan: string, feature: MeteredFeature): number {
  return (PLANS[plan as keyof typeof PLANS] || PLANS.standard).limits[feature];
}
export async function reserveMonthlyQuota(req: Request, res: Response, feature: MeteredFeature, amount = 1): Promise<boolean> {
  const { rows } = req.user ? await pool.query("select plan,status from subscriptions where user_id=$1 limit 1", [req.user.id]) : { rows: [] };
  const subscription = rows[0];
  const plan = subscription && ["active", "trialing"].includes(subscription.status) ? subscription.plan : "standard";
  const limit = planLimit(plan, feature);
  const month = new Date().toISOString().slice(0, 7);
  const allowed = await takeBudget(`quota:${actorKey(req)}:${feature}:${month}`, limit === -1 ? 2147483647 : limit, amount, Number.MAX_SAFE_INTEGER);
  if (!allowed) res.status(403).json({ message: `Monthly ${feature} limit reached (${limit}). Your quota resets next calendar month.`, limit, feature });
  return allowed;
}
