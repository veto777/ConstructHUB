import type { Entitlements } from "../entitlements";
import { fitsLimit, PLANS, PLAN_KEYS, type PlanLimits } from "@shared/plans";

/**
 * The SEO tools are gated on the SEO allowance itself (owner, 2026-10-08: the
 * tools are included with the Agency plan only). A plan — or an account's
 * allowances after grandfathering (server/entitlements.ts) — includes them
 * when its tracked-keyword allowance is not 0; -1 is unlimited (platform
 * admins). Site Scans are no longer the test: a plan can have Site Scans and
 * no SEO tools.
 */
export const seoAllowanceTest = (a: PlanLimits) => a.seoKeywords !== 0;
export const seoIncluded = (ent: Entitlements) => !!ent.allowances && seoAllowanceTest(ent.allowances);
export const SEO_FEATURE = "SEO tools (rank tracking, keyword research, backlinks)";
/** The cheapest plan that includes the SEO tools, named from the price book (the top plan if none did). */
export const SEO_PLAN_NAME = PLANS[PLAN_KEYS.find((k) => PLANS[k].limits.seoKeywords !== 0) ?? PLAN_KEYS[PLAN_KEYS.length - 1]].name;
/**
 * What a queued rank run says when the account no longer has the SEO tools by
 * the time it would be posted (a trial that ended, a plan change): nothing is
 * posted and nothing is charged (server/seo/jobs.ts postQueuedRun).
 */
export const SEO_PLAN_SKIPPED_MESSAGE = `Not run: the SEO tools are included with the ${SEO_PLAN_NAME} plan, and this account's plan no longer includes them. Accounts that already have them keep them.`;

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
