/**
 * Retention for the SEO history tables (reliability review H3, 2026-10-09). Nothing ever deleted history before:
 * seo_rank_checks grows by ~3 KB a check (ten results with URL and title, the map pack, rivals), 730k rows a year for
 * a 1,000-keyword two-device daily site, and crawls keep every page in one JSON value for good.
 *
 * The policy — summaries forever, raw detail for a bounded time:
 *
 *   table                   kept forever                                  pruned (default)
 *   seo_rank_checks         position, url, local_position, device, date   serp_top, local_pack, rivals, serp_features
 *                           (the daily summary every history reads)       cleared after RANK_DETAIL_DAYS (180 d; the
 *                                                                         longest reader window is the 120-day report)
 *   seo_rank_runs           —                                             closed runs deleted after RUNS_DAYS (365 d;
 *                                                                         checks keep their rows, run_id → NULL)
 *   seo_backlink_snapshots  summary, changes, cost, date                  the `backlinks` list cleared after SNAPSHOT_DETAIL_DAYS (365 d)
 *   seo_keyword_snapshots   total, cost, date                             the `keywords` list cleared after SNAPSHOT_DETAIL_DAYS
 *   seo_mention_checks      —                                             rows deleted after SNAPSHOT_DETAIL_DAYS
 *   sitescan_jobs           report (the audit summary), status, dates     state->'pages' (every crawled page) removed
 *                                                                         from completed crawls after CRAWL_PAGES_DAYS (180 d)
 *   seo_report_cache / seo_reservations: already pruned by their own code (30 d / 90 d after settling).
 *
 * How it runs: from the SEO tick (server/seo/jobs.ts) once a day in the quiet hour (PRUNE_HOUR_UTC, 03:00–03:59 UTC
 * = 23:00 ET), at most PRUNE_CAP rows per statement per night (SEO_PRUNE_CAP, 5,000) so a first run over an old
 * database is spread across nights instead of one long lock. Never at boot. Each statement runs on its own with the
 * pool's statement_timeout; a failure is logged to the issue desk and the night is tried again the next tick. The
 * last successful date is kept in seo_meta ('retention_pruned_on').
 */
import { pool } from "../db";
import { recordFailure } from "../ops/issues";

const envInt = (name: string, fallback: number, min = 1) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback; };

export const RETENTION = {
  /** Days a rank check keeps its SERP detail (serp_top, local_pack, rivals, serp_features). */
  RANK_DETAIL_DAYS: envInt("SEO_RETENTION_RANK_DETAIL_DAYS", 180, 30),
  /** Days a closed rank run row is kept. */
  RUNS_DAYS: envInt("SEO_RETENTION_RUNS_DAYS", 365, 30),
  /** Days a backlink / keyword snapshot keeps its list, and a mention check its row. */
  SNAPSHOT_DETAIL_DAYS: envInt("SEO_RETENTION_SNAPSHOT_DAYS", 365, 30),
  /** Days a completed crawl keeps its pages (the report stays). */
  CRAWL_PAGES_DAYS: envInt("SEO_RETENTION_CRAWL_PAGES_DAYS", 180, 30),
  /** Rows touched per statement per night. */
  CAP: envInt("SEO_PRUNE_CAP", 5_000, 100),
  /** The UTC hour the nightly pass runs in. */
  HOUR_UTC: envInt("SEO_PRUNE_HOUR_UTC", 3, 0),
} as const;

export const PRUNED_ON_KEY = "retention_pruned_on";

/** Is the nightly pass due: inside the quiet hour and not yet done for today's UTC date? */
export function retentionDue(now: Date, lastPrunedOn: string | null, hourUtc = RETENTION.HOUR_UTC): boolean {
  if (now.getUTCHours() !== hourUtc) return false;
  return lastPrunedOn !== now.toISOString().slice(0, 10);
}

export type PruneStatement = { table: string; sql: string; params: unknown[] };

/** The night's statements, in order, each bounded to `cap` rows by id. */
export function pruneStatements(r = RETENTION): PruneStatement[] {
  const cap = r.CAP;
  return [
    { table: "seo_rank_checks", params: [r.RANK_DETAIL_DAYS, cap], sql:
      `UPDATE seo_rank_checks SET serp_top=NULL, local_pack=NULL, rivals=NULL, serp_features='[]'::jsonb
        WHERE id IN (SELECT id FROM seo_rank_checks WHERE checked_on < current_date - $1::int
                       AND (serp_top IS NOT NULL OR local_pack IS NOT NULL OR rivals IS NOT NULL OR serp_features <> '[]'::jsonb)
                     ORDER BY id LIMIT $2)` },
    { table: "seo_rank_runs", params: [r.RUNS_DAYS, cap], sql:
      `DELETE FROM seo_rank_runs WHERE id IN (SELECT id FROM seo_rank_runs WHERE status IN ('done','failed') AND coalesce(finished_at, created_at) < now() - make_interval(days => $1::int) ORDER BY created_at LIMIT $2)` },
    { table: "seo_backlink_snapshots", params: [r.SNAPSHOT_DETAIL_DAYS, cap], sql:
      `UPDATE seo_backlink_snapshots SET backlinks='[]'::jsonb WHERE id IN (SELECT id FROM seo_backlink_snapshots WHERE taken_on < current_date - $1::int AND backlinks <> '[]'::jsonb ORDER BY id LIMIT $2)` },
    { table: "seo_keyword_snapshots", params: [r.SNAPSHOT_DETAIL_DAYS, cap], sql:
      `UPDATE seo_keyword_snapshots SET keywords='[]'::jsonb WHERE id IN (SELECT id FROM seo_keyword_snapshots WHERE taken_on < current_date - $1::int AND keywords <> '[]'::jsonb ORDER BY id LIMIT $2)` },
    { table: "seo_mention_checks", params: [r.SNAPSHOT_DETAIL_DAYS, cap], sql:
      `DELETE FROM seo_mention_checks WHERE id IN (SELECT id FROM seo_mention_checks WHERE run_on < current_date - $1::int ORDER BY id LIMIT $2)` },
    { table: "sitescan_jobs", params: [r.CRAWL_PAGES_DAYS, cap], sql:
      `UPDATE sitescan_jobs SET state = state - 'pages' WHERE id IN (SELECT id FROM sitescan_jobs WHERE status='completed' AND completed_at < now() - make_interval(days => $1::int) AND state ? 'pages' ORDER BY completed_at LIMIT $2)` },
  ];
}

export type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/**
 * One night's pass: every statement in turn, each capped. Returns rows touched per table, or null when not due.
 * `q` and `now` are seams for the checks; the tick calls it bare.
 */
export async function pruneSeoHistory(q: Queryable = pool, now: Date = new Date()): Promise<Record<string, number> | null> {
  const { rows: [meta] } = await q.query("SELECT value FROM seo_meta WHERE key=$1", [PRUNED_ON_KEY]).catch(() => ({ rows: [] as any[] }));
  if (!retentionDue(now, meta?.value ?? null)) return null;
  const touched: Record<string, number> = {};
  let failed = 0;
  for (const s of pruneStatements()) {
    try {
      const r = await q.query(s.sql, s.params);
      touched[s.table] = Number(r.rowCount ?? 0);
    } catch (e: any) {
      // A missing table (a module not installed here) is nothing to report; anything else is.
      if (e?.code === "42P01") { touched[s.table] = 0; continue; }
      failed++;
      console.error(`[seo] retention: ${s.table} could not be pruned tonight: ${e?.message ?? e}`);
      void recordFailure("job", "SEO history retention", e, { table: s.table });
    }
  }
  // The night counts as done only when every statement ran; otherwise the next tick in the hour tries again.
  if (!failed) {
    await q.query("INSERT INTO seo_meta(key, value) VALUES($1, $2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()", [PRUNED_ON_KEY, now.toISOString().slice(0, 10)]);
    const summary = Object.entries(touched).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(", ") || "nothing to prune";
    console.log(`[seo] retention: ${summary} (cap ${RETENTION.CAP} per table; detail ${RETENTION.RANK_DETAIL_DAYS}d, snapshots ${RETENTION.SNAPSHOT_DETAIL_DAYS}d, crawl pages ${RETENTION.CRAWL_PAGES_DAYS}d, runs ${RETENTION.RUNS_DAYS}d)`);
  }
  return touched;
}
