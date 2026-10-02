/**
 * Win jobs: permit searches, property records (real NETR-sourced reference
 * directory), Competitor Intel, the Google Ads & LSA manager and LSA Leads.
 * SPEC §3.5.
 *
 * Ads spend and clicks: ads_accounts.snapshot holds the account STRUCTURE the
 * protections read (campaign, campaignCriterion, sharedSet, … — STATE_QUERIES
 * in server/ads/protections.ts) and no metrics.* fields, so the tile shows no
 * spend or clicks. Nothing is estimated in their place.
 */
import { dq } from "../pool";
import { EMPTY, int, iso, metric, num, ok, watch, type TileSources } from "./types";

/** Counties with an active appraiser office: reference data, shared by every account. */
const PROPERTY_CACHE_MS = 10 * 60_000;
let propertyCache: { at: number; counties: number } | null = null;
export const clearPropertyCache = () => { propertyCache = null; };

export const winTiles: TileSources = {
  async permits(ctx) {
    const [[r], usage] = await Promise.all([
      dq(`SELECT count(*) FILTER (WHERE created_at > now() - interval '7 days')::int week, max(created_at) last
            FROM search_queries WHERE user_id=$1`, [ctx.userId]),
      ctx.usage(),
    ]);
    // Always "ok": the plan's search meter is meaningful from day one.
    return ok([
      metric("searches", "Searches used", usage.searches.used, "count", { limit: usage.searches.limit, hint: "this month" }),
      metric("searches7d", "Searches (7 days)", int(r.week), "count"),
      metric("lastSearch", "Last search", iso(r.last), "datetime"),
    ]);
  },

  async property(ctx) {
    const now = ctx.now.getTime();
    if (!propertyCache || now - propertyCache.at > PROPERTY_CACHE_MS) {
      const [r] = await dq("SELECT count(DISTINCT county_id)::int n FROM property_appraisers WHERE is_active");
      propertyCache = { at: now, counties: int(r.n) };
    }
    if (!propertyCache.counties) return EMPTY;
    return ok(
      [metric("counties", "Counties with an appraiser office", propertyCache.counties, "count", { hint: "Sourced from NETR Online" })],
      { label: "Look up a property", href: "/property", surface: "app" },
    );
  },

  async competitors(ctx) {
    const [[r], usage] = await Promise.all([
      dq(`SELECT (SELECT count(*)::int FROM competitor_scans WHERE user_id=$1) total, last.created_at, last.total_found
            FROM (SELECT 1) one
            LEFT JOIN LATERAL (SELECT created_at, total_found FROM competitor_scans
                                WHERE user_id=$1 AND status='completed' ORDER BY created_at DESC, id DESC LIMIT 1) last ON true`, [ctx.userId]),
      ctx.usage(),
    ]);
    if (!int(r.total)) return EMPTY;
    return ok([
      metric("scans", "Scans used", usage.competitorScans.used, "count", { limit: usage.competitorScans.limit, hint: "this month" }),
      metric("lastScan", "Last scan", iso(r.created_at), "datetime"),
      metric("found", "Competitors found", num(r.total_found), "count", { hint: "last scan" }),
    ]);
  },

  async adsManager(ctx) {
    const [r] = await dq(
      `SELECT EXISTS(SELECT 1 FROM ads_grants WHERE user_id=$1) has_grant,
              (SELECT count(*)::int FROM ads_accounts WHERE user_id=$1 AND NOT manager) clients,
              (SELECT count(*)::int FROM ads_accounts WHERE user_id=$1 AND NOT manager AND lsa) lsa,
              (SELECT count(*)::int FROM ads_findings WHERE user_id=$1) findings`, [ctx.userId]);
    if (!r.has_grant) return EMPTY;
    return ok([
      metric("clientAccounts", "Client accounts", int(r.clients), "count"),
      metric("lsaAccounts", "With Local Services", int(r.lsa), "count"),
      metric("findings", "Audit findings", int(r.findings), "count", { hint: "latest audit", tone: watch(int(r.findings)) }),
    ]);
  },

  async lsaLeads(ctx) {
    const [conn] = await dq(
      "SELECT last_sync_at, last_cost_total FROM lsa_connections WHERE user_id=$1 AND refresh_token IS NOT NULL LIMIT 1", [ctx.userId]);
    if (!conn) return EMPTY;
    const [r] = await dq(
      `SELECT count(*) FILTER (WHERE coalesce(lead_creation_time, created_at) > now() - interval '30 days')::int month,
              count(*) FILTER (WHERE dispute_status IN ('scheduled','queued','sending'))::int disputes
         FROM lsa_leads WHERE user_id=$1`, [ctx.userId]);
    const cost = num(conn.last_cost_total);
    return ok([
      metric("leads30d", "Leads (30 days)", int(r.month), "count"),
      metric("disputes", "Disputes in flight", int(r.disputes), "count", { tone: int(r.disputes) ? "warn" : undefined }),
      metric("lastSync", "Last sync", iso(conn.last_sync_at), "datetime"),
      metric("cost", "LSA cost", cost === null ? null : Math.round(cost * 100), "cents", { hint: "reported by Google at the last sync" }),
    ]);
  },
};
