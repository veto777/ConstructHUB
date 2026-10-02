/**
 * Recent activity (SPEC §2 → recent): the user's own notifications (last 30
 * days, up to 10) merged with the active CRM org's Team Activity (up to 5,
 * reporting seats only — the same gate and logic as /api/crm/team-activity),
 * newest first, at most 12. Each source is read on its own.
 */
import type { DashboardRecentItem } from "@shared/dashboard";
import { crmTeamActivityFor } from "../crm/stats";
import { NOTIFICATION_DAYS } from "../account-events";
import type { DashboardContext } from "./context";
import { dq } from "./pool";
import { iso } from "./tiles/types";

const MAX_RECENT = 12;
const SEVERITIES = new Set(["info", "warning", "critical"]);

async function notifications(userId: number): Promise<DashboardRecentItem[]> {
  const rows = await dq(
    `SELECT id, title, body, link, severity, read_at, created_at FROM user_notifications
      WHERE user_id=$1 AND created_at > now() - interval '${NOTIFICATION_DAYS} days'
      ORDER BY created_at DESC, id DESC LIMIT 10`, [userId]);
  return rows.map((n) => {
    // Notification links are paths; anything else (an absolute URL) is dropped rather than guessed at.
    const href = typeof n.link === "string" && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : null;
    return {
      id: `n:${n.id}`,
      at: iso(n.created_at) ?? new Date(0).toISOString(),
      source: "notification" as const,
      title: n.title,
      ...(n.body ? { body: n.body } : {}),
      ...(href ? { href } : {}),
      // CRM paths live on the portal host; everything else is an app page.
      surface: href && /^\/crm(?:[/?#]|$)/.test(href) ? "portal" as const : "app" as const,
      severity: (SEVERITIES.has(n.severity) ? n.severity : "info") as DashboardRecentItem["severity"],
      unread: n.read_at == null,
    };
  });
}

async function crmActivity(ctx: DashboardContext): Promise<DashboardRecentItem[]> {
  const crm = ctx.crm;
  if (!crm || !crm.permissions.seeReporting) return [];
  const items = await crmTeamActivityFor(crm, 5);
  return items.map((a) => ({
    id: `c:${a.id}`,
    at: a.at,
    source: "crm" as const,
    title: `${a.actor} ${a.text}`,
    ...(a.link ? { href: a.link } : {}),
    surface: "portal" as const,
    severity: "info" as const,
  }));
}

export async function buildRecent(ctx: DashboardContext, log: (key: string, err: unknown) => void = () => {}): Promise<DashboardRecentItem[]> {
  const [n, c] = await Promise.allSettled([notifications(ctx.userId), crmActivity(ctx)]);
  if (n.status === "rejected") log("notifications", n.reason);
  if (c.status === "rejected") log("crm", c.reason);
  const items = [...(n.status === "fulfilled" ? n.value : []), ...(c.status === "fulfilled" ? c.value : [])];
  items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return items.slice(0, MAX_RECENT);
}
