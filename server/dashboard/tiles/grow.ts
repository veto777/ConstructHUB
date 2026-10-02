/**
 * Grow: Google Business Profile, reviews, Profile Guard, ranking grid,
 * posts & photos, social, Site Scan, media. Every query is scoped to the
 * signed-in user (user_id = $1). SPEC §3.5.
 */
import { dq } from "../pool";
import { EMPTY, int, iso, metric, num, ok, watch, type TileSources } from "./types";

export const growTiles: TileSources = {
  async gbp(ctx) {
    const [[r], locations] = await Promise.all([
      dq(`SELECT (SELECT count(*)::int FROM gbp_grants WHERE user_id=$1) grants,
                 (SELECT count(*)::int FROM gbp_grants WHERE user_id=$1 AND reconnect_required) reconnect,
                 (SELECT count(DISTINCT s.location_id)::int FROM gbp_sync_status s
                    JOIN business_locations l ON l.id=s.location_id AND l.user_id=$1
                   WHERE s.last_error IS NOT NULL) sync_issues`, [ctx.userId]),
      ctx.locations(),
    ]);
    if (!int(r.grants) && !locations) return EMPTY;
    const reconnect = int(r.reconnect);
    return ok([
      metric("locations", "Locations linked", locations, "count", { limit: ctx.ent.allowances?.locations }),
      metric("googleAccounts", "Google accounts", int(r.grants), "count", reconnect ? { hint: `${reconnect} need${reconnect === 1 ? "s" : ""} reconnecting`, tone: "warn" } : {}),
      metric("syncIssues", "Sync issues", int(r.sync_issues), "count", { tone: watch(int(r.sync_issues)) }),
    ]);
  },

  async reviews(ctx) {
    const [[r], [req]] = await Promise.all([
      dq(`SELECT count(*)::int total,
                 round(avg(rating)::numeric, 1) avg_rating,
                 count(*) FILTER (WHERE review_date > now() - interval '7 days')::int new7,
                 count(*) FILTER (WHERE reply_comment IS NULL)::int unanswered
            FROM google_profile_reviews WHERE user_id=$1 AND google_deleted IS NOT TRUE`, [ctx.userId]),
      dq("SELECT EXISTS(SELECT 1 FROM review_requests WHERE user_id=$1) has_any", [ctx.userId]),
    ]);
    if (!int(r.total) && !req.has_any) return EMPTY;
    return ok([
      metric("rating", "Average rating", int(r.total) ? num(r.avg_rating) : null, "rating"),
      metric("newThisWeek", "New this week", int(r.new7), "count", { tone: int(r.new7) ? "good" : undefined }),
      metric("unanswered", "Awaiting reply", int(r.unanswered), "count", { tone: watch(int(r.unanswered)) }),
    ]);
  },

  async profileGuard(ctx) {
    const [[g], [c]] = await Promise.all([
      dq(`SELECT count(*)::int total, count(*) FILTER (WHERE mode <> 'off')::int guarded, max(checked_at) last_check
            FROM gbp_guard WHERE user_id=$1`, [ctx.userId]),
      dq("SELECT count(*)::int pending FROM gbp_guard_changes WHERE user_id=$1 AND status='pending'", [ctx.userId]),
    ]);
    if (!int(g.total) && !int(c.pending)) return EMPTY;
    return ok([
      metric("guarded", "Locations guarded", int(g.guarded), "count", { limit: ctx.ent.allowances?.locations }),
      metric("pending", "Edits to review", int(c.pending), "count", { tone: watch(int(c.pending)) }),
      metric("lastCheck", "Last check", iso(g.last_check), "datetime"),
    ]);
  },

  async rankingGrid(ctx) {
    const [[r], usage] = await Promise.all([
      dq(`SELECT (SELECT count(*)::int FROM ranking_grid_scans WHERE user_id=$1) total, last.created_at, last.average_rank
            FROM (SELECT 1) one
            LEFT JOIN LATERAL (SELECT created_at, average_rank FROM ranking_grid_scans
                                WHERE user_id=$1 AND status='completed' ORDER BY created_at DESC, id DESC LIMIT 1) last ON true`, [ctx.userId]),
      ctx.usage(),
    ]);
    if (!int(r.total)) return EMPTY;
    return ok([
      metric("credits", "Credits used", usage.rankings.used, "count", { limit: usage.rankings.limit, hint: "this month" }),
      metric("lastScan", "Last grid", iso(r.created_at), "datetime"),
      metric("averageRank", "Average rank (last grid)", r.average_rank?.trim() || null, "text"),
    ]);
  },

  async gbpContent(ctx) {
    const [r] = await dq(
      `SELECT count(*)::int total,
              count(*) FILTER (WHERE status='queued')::int scheduled,
              count(*) FILTER (WHERE status='published' AND coalesce(started_at, due_at, created_at) > now() - interval '30 days')::int published30d,
              count(*) FILTER (WHERE status IN ('failed','uncertain','rejected'))::int attention
         FROM gbp_content_jobs WHERE user_id=$1`, [ctx.userId]);
    if (!int(r.total)) return EMPTY;
    return ok([
      metric("scheduled", "Scheduled", int(r.scheduled), "count"),
      metric("published30d", "Published (30 days)", int(r.published30d), "count"),
      metric("attention", "Need attention", int(r.attention), "count", { tone: watch(int(r.attention)) }),
    ]);
  },

  async social(ctx) {
    const [[c], [r]] = await Promise.all([
      dq("SELECT count(*)::int n FROM social_connections WHERE user_id=$1", [ctx.userId]),
      dq(`SELECT count(*) FILTER (WHERE state='queued')::int scheduled,
                 count(*) FILTER (WHERE state='published' AND updated_at > now() - interval '30 days')::int published30d,
                 count(*) FILTER (WHERE state IN ('failed','uncertain'))::int failed
            FROM social_posts WHERE user_id=$1`, [ctx.userId]),
    ]);
    if (!int(c.n)) return EMPTY;
    return ok([
      metric("scheduled", "Scheduled", int(r.scheduled), "count"),
      metric("published30d", "Published (30 days)", int(r.published30d), "count"),
      metric("failed", "Failed", int(r.failed), "count", { tone: watch(int(r.failed)) }),
    ]);
  },

  async siteScan(ctx) {
    const [[r], usage] = await Promise.all([
      dq(`SELECT (SELECT count(*)::int FROM sitescan_jobs WHERE user_id=$1) total, last.score, last.completed_at
            FROM (SELECT 1) one
            LEFT JOIN LATERAL (SELECT report->'scores'->>'overall' score, completed_at FROM sitescan_jobs
                                WHERE user_id=$1 AND status='completed' ORDER BY completed_at DESC NULLS LAST, created_at DESC LIMIT 1) last ON true`, [ctx.userId]),
      ctx.usage(),
    ]);
    if (!int(r.total)) return EMPTY;
    const score = num(r.score);
    const rounded = score === null ? null : Math.round(score);
    return ok([
      metric("score", "Last score", rounded, "score", rounded === null ? {} : { tone: rounded >= 80 ? "good" : rounded >= 50 ? "warn" : "bad" }),
      metric("scans", "Scans used", usage.siteScans.used, "count", { limit: usage.siteScans.limit, hint: "this month" }),
      metric("lastScan", "Last scan", iso(r.completed_at), "datetime"),
    ]);
  },

  async media(ctx) {
    const [r] = await dq(
      `SELECT (SELECT count(*)::int FROM media_photos WHERE user_id=$1) photos,
              (SELECT count(*)::int FROM media_folders WHERE user_id=$1) folders`, [ctx.userId]);
    if (!int(r.photos) && !int(r.folders)) return EMPTY;
    return ok([
      metric("photos", "Photos stored", int(r.photos), "count"),
      metric("folders", "Folders", int(r.folders), "count"),
    ]);
  },
};
