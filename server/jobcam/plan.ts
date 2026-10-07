/**
 * JobCam plan gate — the same rule as the rest of the CRM: the org OWNER's
 * plan decides (seats, texting and Project Photos all key off it). Any paid
 * plan includes JobCam, platform admins and beta accounts are never gated,
 * and a missing plan answers the standard 402 plan_required (no prices here;
 * the client's plan prompt links to Pricing).
 */
import { pool } from "../db";
import type { OrgContext } from "../crm/tenancy";
import { getEntitlements, sendPlanRequired, cheapestPlanWhere, TOP_PLAN } from "../entitlements";

export async function jobcamEntitled(ownerUserId: number): Promise<boolean> {
  const ent = await getEntitlements(ownerUserId);
  if (ent.isPlatformAdmin || ent.allowances) return true;
  const { rows: [owner] } = await pool.query("SELECT beta_at FROM users WHERE id=$1", [ownerUserId]);
  return !!owner?.beta_at;
}

/** Guard a JobCam write: true when allowed, else the 402 is already sent. */
export async function requireJobcamPlan(res: any, ctx: OrgContext): Promise<boolean> {
  if (await jobcamEntitled(ctx.org.ownerUserId)) return true;
  sendPlanRequired(res, cheapestPlanWhere(() => true) ?? TOP_PLAN, "JobCam photos and video", {
    message: "JobCam comes with every paid ConstructHUB plan. The account owner can pick one in Pricing.",
  });
  return false;
}
