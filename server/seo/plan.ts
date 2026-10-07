import type { Entitlements } from "../entitlements";
import type { PlanLimits } from "@shared/plans";

/**
 * The SEO tools are gated like Site Scan: any plan that includes Site Scans
 * (a monthly count, or a per-location count on Agency) includes them. Same
 * test server/growth-quotas.ts uses for the siteScans meter.
 */
export const seoAllowanceTest = (a: PlanLimits) => a.siteScans === -1 || a.siteScans > 0 || a.siteScansPerLocation > 0;
export const seoIncluded = (ent: Entitlements) => !!ent.allowances && seoAllowanceTest(ent.allowances);
export const SEO_FEATURE = "SEO tools (rank tracking, keyword research, backlinks)";
