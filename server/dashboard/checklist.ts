/**
 * Getting started (SPEC §2 → checklist): the steps that apply to this plan,
 * each `done` from real state. Every step is read on its own; a step whose
 * source fails is `done: false` and never blocks the page.
 */
import type { DashboardChecklistItem, DashboardChecklistKey } from "@shared/dashboard";
import { orgSmsStatus } from "../crm/sms";
import type { DashboardContext } from "./context";
import { dq } from "./pool";

type Step = Omit<DashboardChecklistItem, "done"> & { applies: boolean; done: () => Promise<boolean> };

const exists = async (sql: string, params: unknown[]) => (await dq(sql, params)).length > 0;

export async function buildChecklist(ctx: DashboardContext, log: (key: string, err: unknown) => void = () => {}): Promise<DashboardChecklistItem[]> {
  const { userId, ent, crm } = ctx;
  const a = ent.allowances;
  const hasPlan = !!ent.accessPlan;
  const steps: Step[] = [
    {
      key: "connectGoogle", label: "Connect Google", description: "Link the Google account that manages your Business Profile.",
      href: "/locations", surface: "app", applies: true,
      done: () => exists("SELECT 1 FROM gbp_grants WHERE user_id=$1 LIMIT 1", [userId]),
    },
    {
      key: "addLocation", label: "Add a location", description: "Pick the business locations you want to manage here.",
      href: "/locations", surface: "app", applies: true,
      done: async () => (await ctx.locations()) > 0,
    },
    {
      key: "turnOnGuard", label: "Turn on Profile Guard", description: "Get an alert when someone edits your Google profile.",
      href: "/gmb-monitor", surface: "app", applies: hasPlan,
      done: () => exists("SELECT 1 FROM gbp_guard WHERE user_id=$1 AND mode <> 'off' LIMIT 1", [userId]),
    },
    {
      key: "runSiteScan", label: "Run a Site Scan", description: "See what's holding your website back in Google.",
      href: "/site-scan", surface: "app", applies: hasPlan,
      done: () => exists("SELECT 1 FROM sitescan_jobs WHERE user_id=$1 LIMIT 1", [userId]),
    },
    {
      // Sent whatever the flag: the client drops it while SHOW_GOOGLE_REVIEWS is off.
      key: "requestReviews", label: "Ask for a review", description: "Send your last happy customer a review request.",
      href: "/google-reviews", surface: "app", applies: true,
      done: () => exists("SELECT 1 FROM review_requests WHERE user_id=$1 LIMIT 1", [userId]),
    },
    {
      key: "protectWebsite", label: "Protect your website", description: "Add Click Guard to the site your ads point at.",
      href: "/google-ads", surface: "app", applies: !!a && a.protectedSites !== 0,
      done: async () => (await ctx.trackedDomainIds()).length > 0,
    },
    {
      key: "setUpCrm", label: "Set up the CRM", description: "Your profile and company details print on every estimate.",
      ...(crm ? { href: "/crm", surface: "portal" as const } : { href: "/crm-app", surface: "app" as const }),
      applies: true,
      // The required steps of GET /api/crm/onboarding (server/crm/routes.ts): your
      // profile, and the company details unless this seat can't edit them.
      done: async () => {
        if (!crm) return false;
        const me = crm.member, org = crm.org;
        const profileDone = Boolean(me.displayName?.trim() && me.phone?.trim());
        const companyDone = Boolean(org.name?.trim() && org.addressLine1?.trim() && org.city?.trim() && org.state?.trim() && org.phone?.trim());
        return profileDone && (companyDone || !crm.permissions.manageSettings);
      },
    },
    {
      key: "inviteTeammate", label: "Invite a teammate", description: "Add office staff or crew to the CRM.",
      ...(crm ? { href: "/crm/team?tab=team", surface: "portal" as const } : { href: "/crm-app", surface: "app" as const }),
      applies: true,
      done: async () => {
        const [r] = await dq(
          `SELECT EXISTS(SELECT 1 FROM crm_orgs o WHERE o.owner_user_id=$1
                          AND (SELECT count(*) FROM crm_members m WHERE m.org_id=o.id AND m.status IN ('active','invited')) > 1) crm_team,
                  EXISTS(SELECT 1 FROM agency_members WHERE user_id=$1) agency_team`, [userId]);
        return !!(r?.crm_team || r?.agency_team);
      },
    },
    {
      key: "addTextingNumber", label: "Turn on client texting", description: "Text clients estimates, reminders and updates.",
      href: "/crm/settings", surface: "portal", applies: !!a && a.clientTexting !== "none",
      done: async () => (crm ? (await orgSmsStatus(crm.org)).configured : false),
    },
  ];

  const shown = steps.filter((s) => s.applies);
  const done = await Promise.allSettled(shown.map((s) => s.done()));
  return shown.map((s, i) => {
    const r = done[i];
    if (r.status === "rejected") log(s.key, r.reason);
    const { applies: _a, done: _d, ...item } = s;
    return { ...item, key: s.key as DashboardChecklistKey, done: r.status === "fulfilled" && r.value === true };
  });
}

