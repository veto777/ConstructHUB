/**
 * JobCam plan gate. JobCam is part of the CRM product, so the ORG OWNER's CRM
 * subscription decides (a team member rides the owner's plan, like seats):
 *
 *   - CRM Max includes it (CrmPlanLimits.jobcam);
 *   - CRM Basic and CRM Essentials get it with the JobCam add-on
 *     (shared/crm-plans.ts CRM_ADDONS.jobcam);
 *   - ConstructHUB staff and beta accounts (users.beta_at) are never gated —
 *     getCrmEntitlements already resolves both to the top plan;
 *   - no CRM plan: no JobCam.
 *
 * Every member route answers the 402 below when the org has no JobCam. Share
 * links already sent (/jc/:token) and the homeowner portal's client-visible
 * media are NOT gated here: a downgrade must not break a link a customer holds.
 */
import type { OrgContext } from "../crm/tenancy";
import { getCrmEntitlements, type CrmEntitlements } from "../crm/entitlements";
import { CRM_PLANS, cheapestCrmPlanWhere, crmAddonAvailableOn, type CrmPlanKey } from "@shared/crm-plans";

/** Why a workspace has JobCam — or that it does not (`via: null`). */
export type JobcamAccess = {
  entitled: boolean;
  via: "plan" | "addon" | "admin" | "beta" | null;
  /** The owner's CRM plan, when there is one (staff and beta read as the top plan). */
  plan: CrmPlanKey | null;
};

/**
 * THE entitlement rule, pure: every gate, /api/crm/me and the tests read this
 * one function. To let something else grant JobCam (a platform plan, say),
 * add the reason here and resolve its input in jobcamEntitled() below.
 */
export function jobcamAccessFrom(ent: Pick<CrmEntitlements, "active" | "via" | "plan" | "limits" | "jobcamAddon">): JobcamAccess {
  const none: JobcamAccess = { entitled: false, via: null, plan: ent.plan };
  if (!ent.active) return none;
  if (ent.via === "admin" || ent.via === "beta") return { entitled: true, via: ent.via, plan: ent.plan };
  if (ent.limits?.jobcam) return { entitled: true, via: "plan", plan: ent.plan };
  if (ent.jobcamAddon && crmAddonAvailableOn("jobcam", ent.plan)) return { entitled: true, via: "addon", plan: ent.plan };
  return none;
}

/** Does the org owned by this account have JobCam, and why. */
export async function jobcamEntitled(ownerUserId: number): Promise<JobcamAccess> {
  return jobcamAccessFrom(await getCrmEntitlements(ownerUserId));
}

/**
 * The 402 for "this CRM plan has no JobCam" — the CRM's own plan-required
 * answer (code crm_plan_required, like requireOrg's) naming the plan that
 * includes it and whether this plan can add it instead. No price in the
 * sentence: the client's upgrade card reads those from the price book, and the
 * iPhone apps show none.
 */
export function jobcamPlanRequiredBody(plan: CrmPlanKey | null) {
  const requiredCrmPlan = cheapestCrmPlanWhere((l) => l.jobcam);
  const name = requiredCrmPlan ? CRM_PLANS[requiredCrmPlan].name : "a higher CRM plan";
  const addon = crmAddonAvailableOn("jobcam", plan) ? "jobcam" as const : null;
  return {
    code: "crm_plan_required" as const,
    feature: "jobcam" as const,
    requiredCrmPlan,
    crmAddon: addon,
    currentCrmPlan: plan,
    message: !plan
      ? "JobCam is part of the ConstructHUB CRM. The account owner can choose a CRM plan to use it."
      : addon
        ? `JobCam isn't on your ${CRM_PLANS[plan].name} plan. The account owner can add JobCam to it, or move to ${name}, where it is included.`
        : `JobCam is included with ${name}. The account owner can change the CRM plan.`,
    href: "/pricing#crm",
  };
}

/** Guard a JobCam member route: true when allowed, else the 402 is already sent. */
export async function requireJobcamPlan(res: any, ctx: OrgContext): Promise<boolean> {
  const access = await jobcamEntitled(ctx.org.ownerUserId);
  if (access.entitled) return true;
  res.status(402).json(jobcamPlanRequiredBody(access.plan));
  return false;
}
