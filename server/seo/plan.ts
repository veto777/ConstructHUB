import type { Entitlements } from "../entitlements";
import { fitsLimit, type PlanLimits } from "@shared/plans";

/**
 * The SEO tools are gated like Site Scan: any plan that includes Site Scans
 * (a monthly count, or a per-location count on Agency) includes them. Same
 * test server/growth-quotas.ts uses for the siteScans meter.
 */
export const seoAllowanceTest = (a: PlanLimits) => a.siteScans === -1 || a.siteScans > 0 || a.siteScansPerLocation > 0;
export const seoIncluded = (ent: Entitlements) => !!ent.allowances && seoAllowanceTest(ent.allowances);
export const SEO_FEATURE = "SEO tools (rank tracking, keyword research, backlinks)";

/** Environment variables the data source reads — named only on the admin card, never to customers. */
export const SEO_ENV_VARS = ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "SEO_MONTHLY_BUDGET_USD"] as const;

/** What a customer reads while the data source is not configured (sites and keywords still save). */
export const SEO_NOT_READY_MESSAGE = "Rank tracking is being switched on for your account — check back shortly.";

/**
 * Tracked keywords are a standing count across the account's sites
 * (shared/plans.ts seoKeywords). Pure: can `adding` more fit under the plan?
 */
export function keywordsFit(allowances: Pick<PlanLimits, "seoKeywords"> | null, used: number, adding: number): boolean {
  if (!allowances) return false;
  return fitsLimit(allowances.seoKeywords, used, adding);
}
