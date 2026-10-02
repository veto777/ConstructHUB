/**
 * The dashboard header: who, which plan, its state, and this month's meters
 * (SPEC §3.6). The plan comes from getEntitlements; the subscription row that
 * decided it is re-read with the same order (SUBSCRIPTION_ORDER in
 * server/entitlements.ts) only for its dates and status.
 */
import { ACCESS_STATUSES, PLANS } from "@shared/plans";
import type { DashboardAccount, DashboardAccountStatus, DashboardUsage } from "@shared/dashboard";
import { getOwnerSeatUsage } from "../crm/tenancy";
import { resetsAt } from "../growth-quotas";
import { NOTIFICATION_DAYS } from "../account-events";
import type { DashboardContext } from "./context";
import { dashboardPool, dq } from "./pool";
import { iso } from "./tiles/types";

type SubscriptionRow = {
  status: string | null;
  stripe_subscription_id: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean | null;
  cancel_at: Date | null;
};

/** Header identity + plan state. Throws only on a failed read (the caller degrades). */
export async function accountHeader(ctx: DashboardContext): Promise<Omit<DashboardAccount, "usage" | "unreadNotifications" | "resetsAt">> {
  const { ent } = ctx;
  const [[user], [sub]] = await Promise.all([
    dq<{ display_name: string | null }>("SELECT display_name FROM users WHERE id=$1", [ctx.userId]),
    // Same row getEntitlements reads (SUBSCRIPTION_ORDER).
    dq<SubscriptionRow>(
      `SELECT status, stripe_subscription_id, current_period_end, cancel_at_period_end, cancel_at FROM subscriptions x
        WHERE x.user_id=$1 ORDER BY (x.status = ANY($2::text[])) DESC, x.id DESC LIMIT 1`, [ctx.userId, ACCESS_STATUSES]),
  ]);
  const displayName = user?.display_name?.trim() || null;

  let status: DashboardAccountStatus = "none";
  let trialEndsAt: string | null = null;
  let renewsAt: string | null = null;
  let endsAt: string | null = null;
  if (ent.plan && sub) {
    if (!sub.stripe_subscription_id) {
      // A Stripe-less grant: a trial code (dated) is a trial; an open-ended manual grant is simply active.
      status = ent.grantEndsAt ? "trialing" : "active";
      trialEndsAt = ent.grantEndsAt ? ent.grantEndsAt.toISOString() : null;
    } else if (sub.status === "trialing") {
      status = "trialing";
      trialEndsAt = iso(sub.current_period_end);
    } else if (sub.status === "active" || sub.status === "past_due") {
      status = sub.status;
      // A subscription set to cancel does not renew: it ends.
      const ending = sub.cancel_at_period_end || sub.cancel_at;
      if (sub.status === "active" && !ending) renewsAt = iso(sub.current_period_end);
      if (ending) endsAt = iso(sub.cancel_at ?? sub.current_period_end);
    }
  } else if (!ent.plan && ent.isPlatformAdmin) {
    // Platform admins run on the top plan without a subscription of their own.
    status = "active";
  }

  return {
    firstName: displayName ? displayName.split(/\s+/)[0] : null,
    displayName,
    plan: ent.plan,
    planName: ent.accessPlan ? PLANS[ent.accessPlan].name : null,
    status,
    isPlatformAdmin: ent.isPlatformAdmin,
    trialEndsAt,
    renewsAt,
    ...(endsAt ? { endsAt } : {}),
  };
}

/** One meter per counted feature the plan includes; limit 0 (not in the plan) is left out. */
export async function accountUsage(ctx: DashboardContext): Promise<DashboardUsage[]> {
  const a = ctx.ent.allowances;
  const [usage, locations, [sites], ownsOrg] = await Promise.all([
    ctx.usage(),
    ctx.locations(),
    dq<{ n: number }>("SELECT count(*)::int n FROM tracked_domains WHERE user_id=$1", [ctx.userId]),
    dq("SELECT 1 FROM crm_orgs WHERE owner_user_id=$1 LIMIT 1", [ctx.userId]).then((r) => r.length > 0),
  ]);
  const rows: DashboardUsage[] = [
    { key: "searches", label: "Permit searches", used: usage.searches.used, limit: usage.searches.limit, period: "monthly", href: "/search" },
    { key: "rankings", label: "Ranking-grid credits", used: usage.rankings.used, limit: usage.rankings.limit, period: "monthly", href: "/ranking-grid" },
    { key: "siteScans", label: "Site Scans", used: usage.siteScans.used, limit: usage.siteScans.limit, period: "monthly", href: "/site-scan" },
    { key: "competitorScans", label: "Competitor scans", used: usage.competitorScans.used, limit: usage.competitorScans.limit, period: "monthly", href: "/competitors" },
    { key: "texts", label: "Texts", used: usage.texts.used, limit: usage.texts.limit, period: "monthly", href: "/settings?tab=billing" },
    { key: "locations", label: "Locations", used: locations, limit: a?.locations ?? 0, period: "count", href: "/locations" },
    { key: "protectedSites", label: "Protected websites", used: sites?.n ?? 0, limit: a?.protectedSites ?? 0, period: "count", href: "/google-ads" },
  ];
  if (ownsOrg) {
    const seats = await getOwnerSeatUsage(ctx.userId, { client: dashboardPool(), ent: ctx.ent });
    rows.push({ key: "crmSeats", label: "CRM seats", used: seats.used, limit: seats.limit, period: "count", href: "/crm/team?tab=team", surface: "portal" });
  }
  return rows.filter((r) => r.limit !== 0);
}

/** The header bell's unread count (the /api/notifications query). */
export async function unreadNotifications(userId: number): Promise<number> {
  const [r] = await dq<{ n: number }>(
    `SELECT count(*)::int n FROM user_notifications WHERE user_id=$1 AND read_at IS NULL AND created_at > now() - interval '${NOTIFICATION_DAYS} days'`, [userId]);
  return r?.n ?? 0;
}

export { resetsAt };
