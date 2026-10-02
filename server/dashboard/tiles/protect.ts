/**
 * Protect: Click Guard, IP Tracker, VPN Shield (all through the user's
 * tracked_domains — click_visits, blocked_ips and vpn_visits have no user_id),
 * Cloudflare and Search Console (edge_*), Domains and Mail alerts. SPEC §3.5.
 */
import { dq } from "../pool";
import { EMPTY, int, metric, num, ok, watch, type TileSources } from "./types";

const DAY = 86_400_000;

export const protectTiles: TileSources = {
  async clickGuard(ctx) {
    const ids = await ctx.trackedDomainIds();
    if (!ids.length) return EMPTY;
    const [r] = await dq(
      `SELECT (SELECT count(*)::int FROM click_visits WHERE domain_id = ANY($1::int[]) AND is_suspicious AND visited_at > now() - interval '30 days') suspicious,
              (SELECT count(*)::int FROM blocked_ips WHERE domain_id = ANY($1::int[]) AND is_active) blocked`, [ids]);
    return ok([
      metric("sites", "Sites protected", ids.length, "count", { limit: ctx.ent.allowances?.protectedSites }),
      metric("suspicious30d", "Suspicious clicks (30 days)", int(r.suspicious), "count", { tone: watch(int(r.suspicious)) }),
      metric("blockedIps", "IPs excluded", int(r.blocked), "count"),
    ]);
  },

  async ipTracker(ctx) {
    const ids = await ctx.trackedDomainIds();
    if (!ids.length) return EMPTY;
    const [r] = await dq(
      `SELECT count(*)::int visits, count(DISTINCT ip_address)::int uniq
         FROM click_visits WHERE domain_id = ANY($1::int[]) AND visited_at > now() - interval '7 days'`, [ids]);
    return ok([
      metric("visits7d", "Visits (7 days)", int(r.visits), "count"),
      metric("unique7d", "Unique visitors", int(r.uniq), "count", { hint: "by IP address" }),
    ]);
  },

  async vpnShield(ctx) {
    const ids = await ctx.trackedDomainIds();
    if (!ids.length) return EMPTY;
    const [r] = await dq(
      `SELECT count(*)::int blocked, count(DISTINCT ip_address)::int uniq
         FROM vpn_visits WHERE domain_id = ANY($1::int[]) AND action='blocked' AND visited_at > now() - interval '30 days'`, [ids]);
    return ok([
      metric("blocked30d", "VPN visits blocked (30 days)", int(r.blocked), "count"),
      metric("uniqueIps30d", "Unique IPs", int(r.uniq), "count"),
    ]);
  },

  async cloudflare(ctx) {
    const [r] = await dq(
      `SELECT (SELECT count(*)::int FROM edge_connections WHERE user_id=$1 AND provider='cloudflare') accounts,
              count(*)::int zones, count(*) FILTER (WHERE error IS NOT NULL)::int errors
         FROM edge_assets WHERE user_id=$1 AND provider='cloudflare'`, [ctx.userId]);
    if (!int(r.accounts) && !int(r.zones)) return EMPTY;
    return ok([
      metric("zones", "Zones", int(r.zones), "count"),
      metric("accounts", "Accounts connected", int(r.accounts), "count"),
      metric("errors", "Zones with an error", int(r.errors), "count", { tone: watch(int(r.errors)) }),
    ]);
  },

  async searchConsole(ctx) {
    const [r] = await dq(
      `SELECT (SELECT count(*)::int FROM edge_connections WHERE user_id=$1 AND provider='gsc') accounts,
              (SELECT count(*)::int FROM edge_assets WHERE user_id=$1 AND provider='gsc') properties,
              t.days, t.clicks, t.impressions
         FROM (SELECT count(*)::int days, sum(a.clicks) clicks, sum(a.impressions) impressions
                 FROM gsc_analytics a JOIN edge_assets e ON e.id=a.asset_id AND e.user_id=$1 AND e.provider='gsc'
                WHERE a.dimension='date' AND a.date > current_date - 28) t`, [ctx.userId]);
    if (!int(r.accounts) && !int(r.properties)) return EMPTY;
    // No synced rows in the window = not measured yet (null, "—"), never 0.
    const measured = int(r.days) > 0;
    return ok([
      metric("properties", "Properties", int(r.properties), "count"),
      metric("clicks28d", "Clicks (28 days)", measured ? Math.round(num(r.clicks) ?? 0) : null, "count"),
      metric("impressions28d", "Impressions (28 days)", measured ? Math.round(num(r.impressions) ?? 0) : null, "count"),
    ]);
  },

  async domains(ctx) {
    const rows = await dq<{ expires: string | null; auto_renew: string | null }>(
      "SELECT state->>'expires' expires, state->>'autoRenew' auto_renew FROM managed_domains WHERE user_id=$1", [ctx.userId]);
    if (!rows.length) return EMPTY;
    const now = ctx.now.getTime();
    // Same rule as the domain checker (server/domains/service.ts): due within 30 days, lapsed ones included.
    const expiring = rows.filter((d) => {
      const t = d.expires ? Date.parse(d.expires) : NaN;
      return Number.isFinite(t) && Math.ceil((t - now) / DAY) <= 30;
    }).length;
    const autoRenewOff = rows.filter((d) => d.auto_renew === "false").length;
    return ok([
      metric("watched", "Domains watched", rows.length, "count"),
      metric("expiring30d", "Expiring within 30 days", expiring, "count", { tone: watch(expiring) }),
      metric("autoRenewOff", "Auto-renew off", autoRenewOff, "count", { tone: watch(autoRenewOff) }),
    ]);
  },

  async mailAlerts(ctx) {
    const [r] = await dq(
      `SELECT EXISTS(SELECT 1 FROM mail_alert_addresses WHERE user_id=$1) has_address,
              EXISTS(SELECT 1 FROM mail_alert_grants WHERE user_id=$1) has_grant,
              count(*)::int total,
              count(*) FILTER (WHERE read_at IS NULL)::int unread,
              count(*) FILTER (WHERE received_at > now() - interval '7 days')::int week
         FROM mail_alert_messages WHERE user_id=$1 AND expires_at > now()`, [ctx.userId]);
    if (!r.has_address && !r.has_grant && !int(r.total)) return EMPTY;
    return ok([
      metric("unread", "Unread alerts", int(r.unread), "count", { tone: watch(int(r.unread)) }),
      metric("last7d", "Alerts (7 days)", int(r.week), "count"),
    ]);
  },
};
