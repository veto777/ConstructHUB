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
  const key = `quota:${actorKey(req)}:${feature}:${month}`;
  const allowed = await takeBudget(key, limit === -1 ? 2147483647 : limit, amount, Number.MAX_SAFE_INTEGER);
  if (allowed) { res.locals ||= {}; res.locals.growthQuota = { key, remaining: amount }; }
  if (!allowed) res.status(403).json({ message: `Monthly ${feature} limit reached (${limit}). Your quota resets next calendar month.`, limit, feature });
  return allowed;
}

export async function refundQuota(res: Response, amount: number) {
  const reservation = res.locals?.growthQuota;
  if (!reservation || amount <= 0) return;
  const refund = Math.min(amount, reservation.remaining);
  if (refund <= 0) return;
  await pool.query("UPDATE growth_budgets SET used=greatest(0,used-$2) WHERE key=$1 AND period='0'", [reservation.key, refund]);
  reservation.remaining -= refund;
}
