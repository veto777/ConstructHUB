/**
 * SEO background work, on the platform's in-process interval pattern
 * (server/agency/jobs.ts, server/sitescan/worker.ts):
 *
 *   - weekly rank check per site: every keyword × device posted to DataForSEO's
 *     standard queue (task_post, charged), then task_get polled (free) until the
 *     results are in — the flow OpenSEO's workflows/rankCheckPaths.ts uses,
 *     minus the live fallback (stragglers are reported, never re-bought);
 *   - monthly backlink snapshot per site (summary + top 100 backlinks);
 *   - "Run now" from the UI enqueues the same run and kicks it immediately.
 *
 * One instance runs a tick at a time (pg_try_advisory_lock); runs are leased
 * with FOR UPDATE SKIP LOCKED so a kicked run and the tick never both post.
 * Every charged call goes through server/seo/budget.ts.
 */
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { getEntitlements } from "../entitlements";
import { recordFailure } from "../ops/issues";
import { reserveBudget, settleBudget, withBudget, reconcileReservations, refundReservation, SeoBudgetError } from "./budget";
import { retailCents } from "@shared/seo-credits";
import { deliverPendingAlerts } from "./alerts";
import { sendDueReports } from "./site-report-send";
import { trackedCompetitors } from "./voice";
import { runDueAiChecks } from "./ai-monthly";
import { runDueGridWatches } from "./grid-monitor";
import { runDueKeywordSnapshots } from "./keyword-watch";
import { runDueMentionChecks } from "./mention-watch";
import { isConfigured, serpTaskPost, serpTaskGet, backlinksSummary, backlinksList, MAX_TASKS_PER_POST, claimDeadline, type Deadline, type PostedRankTask, type Device, lostLinks, type LostLink } from "./dataforseo";
import { estimateRankCheckUsd, estimateBacklinkSnapshotUsd, devicesOf, serpUsd, type DeviceSet, estimateLostLinksUsd, LOST_LINK_ROWS } from "./pricing";
import { seoIncluded, SEO_NOT_READY_MESSAGE, SEO_PLAN_SKIPPED_MESSAGE } from "./plan";
import { seoLocks } from "./locks";
import { raiseLinkAlerts, rankAlertPlan, saveRankAlerts, deliverAlert, type RunCoverage } from "./alerts";

import { publicFailure } from "./public-errors";
import { backlogWarning, closeDecision } from "./collect-plan";

/** Runs `fn` in one transaction on its own connection. */
async function withTransaction<T>(fn: (db: { query: typeof pool.query }) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const out = await fn(client as any); await client.query("COMMIT"); return out; }
  catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
}
const TICK_MS = 60_000;
const LOCK_KEY = 7192;
/**
 * How long one pass of the collector may spend asking for results (SEO_COLLECT_BUDGET_MS, default 40 s of the 60 s
 * tick). The pass is sized to the backlog, not to a fixed count: it leases runs oldest first and goes on until every
 * pending result was asked for or the time is up — so paid results are never left to expire unread while the
 * process is healthy (server/seo/collect-plan.ts; review H2). The run window itself is RUN_WINDOW_MS there.
 */
const COLLECT_BUDGET_MS = (() => { const n = Number(process.env.SEO_COLLECT_BUDGET_MS); return Number.isFinite(n) && n >= 1_000 ? Math.floor(n) : 40_000; })();
const TASK_GET_CONCURRENCY = 10;
/** How long the poster holds a run between chunks; a run whose lease lapsed is taken over by the collector. */
const POST_LEASE_MINUTES = 5;
/** How long a pass holds a site whose monthly backlink snapshot is due. */
const BACKLINKS_LEASE_HOURS = 6;
export const BACKLINK_ROWS = 100;
export const WEEKLY_SKIPPED_MESSAGE = "This month's included SEO data is used up, so the automatic check was skipped. Automatic checks never spend credit you bought — press Run check now to use it.";
/**
 * How often a site's rankings are checked automatically. `hours` is the gap between checks; `perMonth` the checks in a
 * 30-day month (what the monthly figure on the page is multiplied by). Every one spends the month's included data only.
 */
export const RANK_FREQUENCIES = {
  weekly: { label: "Every week", hours: 168, perMonth: 30 / 7 },
  twice_weekly: { label: "Twice a week", hours: 84, perMonth: 30 / 3.5 },
  daily: { label: "Every day", hours: 24, perMonth: 30 },
} as const;
export type RankFrequency = keyof typeof RANK_FREQUENCIES;
export const RANK_FREQUENCY_KEYS = Object.keys(RANK_FREQUENCIES) as RankFrequency[];
/** The gap for a site's frequency, as SQL (an unknown value is weekly). */
const GAP_SQL = (col: string) => `make_interval(hours => CASE ${col} WHEN 'daily' THEN 24 WHEN 'twice_weekly' THEN 84 ELSE 168 END)`;

export type SiteRow = { id: number; user_id: number; domain: string; location_code: number; language_code: string; devices: DeviceSet; serp_depth: number; business_name?: string | null; alerts_enabled?: boolean; alert_drop?: number; next_rank_check_at?: Date; next_backlinks_at?: Date; last_rank_check_at?: Date | null; last_backlinks_at?: Date | null; created_at?: Date };

export const seoJobDeps = {
  serpTaskPost, serpTaskGet, backlinksSummary, backlinksList, lostLinks,
  /** Does the account's plan still include the tools (the automatic check is skipped when not)? Stubbed by the checks. */
  entitled: async (userId: number): Promise<boolean> => seoIncluded(await getEntitlements(userId)),
};

/** Queue a rank-check run for a site (reuses one already queued/running). `db`: inside a caller's transaction. */
export async function enqueueRankRun(site: SiteRow, trigger: "weekly" | "manual", db: { query: typeof pool.query } = pool): Promise<{ id: string; reused: boolean }> {
  const { rows: [open] } = await db.query(
    "SELECT id FROM seo_rank_runs WHERE site_id=$1 AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1", [site.id]);
  if (open) return { id: open.id, reused: true };
  const id = randomUUID();
  try {
    await db.query("INSERT INTO seo_rank_runs(id,site_id,user_id,trigger) VALUES($1,$2,$3,$4)", [id, site.id, site.user_id, trigger]);
  } catch (e: any) {
    // seo_rank_runs_one_active: another request queued this site's run between the check and the insert. (Inside a
    // transaction the failed insert has ended it, so the caller's transaction is what retries; this path is the plain one.)
    if (e?.code !== "23505" || db !== pool) throw e;
    const { rows: [other] } = await db.query("SELECT id FROM seo_rank_runs WHERE site_id=$1 AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1", [site.id]);
    if (!other) throw e;
    return { id: other.id, reused: true };
  }
  return { id, reused: false };
}

/** Lease one queued run and post its tasks. Returns false when nothing was queued. */
export async function postQueuedRun(runId?: string): Promise<boolean> {
  // The lease is renewed with every chunk saved, and a run whose lease lapsed is taken over by the collector: no chunk
  // is posted unless its request's full timeout, plus a margin, still ends inside the lease — never one that could
  // still be at the source once the run is another pass's.
  let leasedAt = Date.now();
  const { rows: [run] } = await pool.query(
    `UPDATE seo_rank_runs SET status='running', started_at=now(), lease_until=now()+interval '${POST_LEASE_MINUTES} minutes'
     WHERE id=(SELECT id FROM seo_rank_runs WHERE status='queued' AND ($1::uuid IS NULL OR id=$1) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING *`, [runId ?? null]);
  if (!run) return false;
  try {
    const { rows: [site] } = await pool.query("SELECT * FROM seo_sites WHERE id=$1", [run.site_id]);
    const { rows: keywords } = await pool.query("SELECT id, keyword, location_code FROM seo_keywords WHERE site_id=$1 ORDER BY id", [run.site_id]);
    if (!site || !keywords.length) {
      await finishRun(run.id, "failed", keywords.length ? "Site is gone" : "No keywords to check");
      return true;
    }
    // A run is posted later than it was queued: the account's plan is checked again here, before any reservation,
    // so an account that lost the SEO tools in between (a trial that ended, a plan change) is charged nothing —
    // the run closes with the reason, the way an unconfigured source closes it below.
    if (!(await seoJobDeps.entitled(run.user_id))) {
      console.warn(`[seo] run ${run.id} skipped: user ${run.user_id}'s plan no longer includes the SEO tools`);
      await finishRun(run.id, "failed", SEO_PLAN_SKIPPED_MESSAGE);
      return true;
    }
    if (!isConfigured()) {
      // The customer sees the neutral note; the env detail is the log's.
      console.warn(`[seo] run ${run.id} skipped: data source not configured (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD)`);
      await finishRun(run.id, "failed", SEO_NOT_READY_MESSAGE);
      return true;
    }
    const devices = devicesOf(site.devices);
    const inputs = keywords.flatMap((k: any) => devices.map((device) => ({ keyword: k.keyword, keywordId: k.id, device: device as Device, ...(k.location_code ? { locationCode: k.location_code as number } : {}) })));
    const estimate = estimateRankCheckUsd(keywords.map((k: any) => k.keyword), site.devices, site.serp_depth);
    let reservation;
    try {
      // The automatic weekly check spends the month's included data only — never credit the customer bought.
      reservation = await reserveBudget(run.user_id, estimate.usd, { allowanceOnly: run.trigger === "weekly", label: `Rank check — ${keywords.length} keyword${keywords.length === 1 ? "" : "s"} for ${site.domain} (${run.trigger === "weekly" ? "automatic" : "run now"})` });
    } catch (e) {
      if (e instanceof SeoBudgetError) { console.warn(`[seo] run ${run.id} refused: ${e.detail}`); await finishRun(run.id, "failed", run.trigger === "weekly" && e.code === "seo_credits" ? WEEKLY_SKIPPED_MESSAGE : e.message); return true; }
      throw e;
    }
    // What paid for this run is on the run before anything is posted, so a refund can always find it.
    await pool.query("UPDATE seo_rank_runs SET reservation_id=$2 WHERE id=$1", [run.id, reservation.id ?? null]);
    const posted: PostedRankTask[] = [];
    let costUsd = 0;
    // What a chunk that never answered may have cost us (the customer is not charged for it).
    let unknownUsd = 0;
    let firstError: string | null = null;
    for (let i = 0; i < inputs.length; i += MAX_TASKS_PER_POST) {
      const chunk = inputs.slice(i, i + MAX_TASKS_PER_POST);
      try {
        const out = await seoJobDeps.serpTaskPost({ tasks: chunk, locationCode: site.location_code, languageCode: site.language_code, depth: site.serp_depth, targetDomain: site.domain, deadline: claimDeadline(leasedAt, POST_LEASE_MINUTES * 60_000) });
        posted.push(...out.data);
        costUsd += out.costUsd;
        // Saved chunk by chunk: a crash mid-posting must not lose task ids that were already paid for.
        leasedAt = Date.now();
        await pool.query(`UPDATE seo_rank_runs SET tasks=$2, posted=$3, cost_usd=$4, lease_until=now()+interval '${POST_LEASE_MINUTES} minutes' WHERE id=$1`, [run.id, JSON.stringify(posted), posted.length, costUsd]);
      } catch (e: any) {
        firstError ??= e?.message ?? String(e);
        costUsd += typeof e?.costUsd === "number" ? e.costUsd : 0;
        // A chunk never sent (the lease's deadline had passed) cost nothing for certain.
        if (e?.costUnknown !== false && (e?.code === "timeout" || (e?.code === "upstream" && !(e?.costUsd > 0)))) unknownUsd += chunk.reduce((a, t) => a + serpUsd(site.serp_depth, "standard", t.keyword), 0);
        console.warn(`[seo] run ${run.id} task_post chunk ${i / MAX_TASKS_PER_POST} failed: ${firstError}`);
        firstError = "Some checks were not accepted by the search data service.";
      }
    }
    // What the source reported is never trimmed; what it may have charged for a chunk that never answered is added for our ledger only.
    // A run in which nothing was accepted delivers nothing: like any failed lookup, it costs the customer nothing.
    await settleBudget(reservation, costUsd + unknownUsd, posted.length ? costUsd : 0);
    if (!posted.length) {
      // The note is the customer's (it is shown on the rank tracker); why it happened is in the log lines above.
      if (!firstError) console.warn(`[seo] run ${run.id}: the source accepted none of the ${inputs.length} tasks`);
      await finishRun(run.id, "failed", "None of the checks were accepted by the search data service. Your credits were not charged.", costUsd);
      return true;
    }
    await pool.query(
      "UPDATE seo_rank_runs SET tasks=$2, total=$3, cost_usd=$4, error=$5, lease_until=NULL, reservation_id=$6, posted=$7 WHERE id=$1",
      [run.id, JSON.stringify(posted), inputs.length, costUsd, posted.length < inputs.length ? `${inputs.length - posted.length} of ${inputs.length} checks were not accepted by the search data service` : null, reservation.id ?? null, posted.length]);
    await pool.query("UPDATE seo_sites SET last_rank_check_at=now() WHERE id=$1", [site.id]);
  } catch (e: any) {
    // Checks already accepted (and paid for) are kept: the run goes on to collect them instead of being wiped.
    const { rowCount } = await pool.query("UPDATE seo_rank_runs SET lease_until=NULL, posted=jsonb_array_length(tasks), total=greatest(total, jsonb_array_length(tasks)) WHERE id=$1 AND jsonb_array_length(tasks)>0", [run.id]).catch(() => ({ rowCount: 0 }));
    // The run's note is shown to the customer: never the error's own text (that goes to the log and the issue desk).
    console.error(`[seo] run ${run.id} could not be posted: ${e?.message ?? e}`);
    if (!rowCount) await finishRun(run.id, "failed", publicFailure(e, "The check could not be started — try again in a few minutes."));
    void recordFailure("job", "SEO rank run post", e);
  }
  return true;
}

async function finishRun(id: string, status: "done" | "failed", error: string | null, costUsd?: number) {
  await pool.query(
    "UPDATE seo_rank_runs SET status=$2, error=$3, finished_at=now(), lease_until=NULL, tasks='[]'::jsonb, cost_usd=coalesce($4,cost_usd) WHERE id=$1",
    [id, status, error, costUsd ?? null]);
}

/** Poll the queue for running runs; write every finished check; close runs that are complete or past the window. */
export async function collectRunningRuns(): Promise<void> {
  // A run can never stay open for good (one open run per site: a stuck one would block every later check).
  const { rows: stuck } = await pool.query(
    `SELECT id, site_id, reservation_id, posted, cost_usd, failed, checked, total, jsonb_array_length(tasks) AS waiting FROM seo_rank_runs
      WHERE (status='running' AND started_at < now() - interval '3 hours') OR (status='queued' AND created_at < now() - interval '24 hours')
      FOR UPDATE SKIP LOCKED LIMIT 20`).catch(() => ({ rows: [] as any[] }));
  for (const s of stuck) {
    const refund = await refundUnreturned(s, Number(s.waiting ?? 0) + Number(s.failed ?? 0));
    // A run that stopped early may still have saved some rankings: their moves are alerted (said to be from a check
    // that stopped early), worked out and saved in the same transaction that closes the run. If any of that fails,
    // the run stays as it is and is closed on a later tick — never closed without its alerts.
    try {
      const ids = await withTransaction(async (db) => {
        const plan = s.site_id ? await rankAlertPlan(s.site_id, s.id, db) : null;
        await db.query(
          `UPDATE seo_rank_runs SET status='failed', finished_at=now(), lease_until=NULL, tasks='[]'::jsonb, partial = checked < total, error=concat_ws(' · ', error, $2::text) WHERE id=$1`,
          [s.id, `The check stopped before it finished.${refundNote(refund, "The checks that never came back")}`]);
        return saveRankAlerts(db, plan, { delivered: Number(s.checked ?? 0), expected: Number(s.total ?? 0), stopped: true });
      });
      for (const id of ids) await deliverAlert(id).catch(() => {});
    } catch (e: any) {
      console.error(`[seo] run ${s.id} that stopped early could not be closed (it stays and is tried again): ${e?.message ?? e}`);
      void recordFailure("job", "SEO stuck rank run close", e, { runId: s.id });
    }
  }
  // Oldest runs first, 20 at a lease, lease again while time remains: the pass drains the backlog instead of
  // asking for a fixed 300 results. A run already handled this pass is not handled again (its lease was given back).
  const passDeadline = Date.now() + COLLECT_BUDGET_MS;
  const LEASE_BATCH = 20;
  const handled = new Set<string>();
  let unasked = 0;
  let oldestUnasked: string | null = null;
  for (;;) {
    const { rows: leased } = await pool.query(
      `UPDATE seo_rank_runs SET lease_until=now()+interval '5 minutes'
       WHERE id IN (SELECT id FROM seo_rank_runs WHERE status='running' AND (lease_until IS NULL OR lease_until<now()) ORDER BY started_at FOR UPDATE SKIP LOCKED LIMIT ${LEASE_BATCH})
       RETURNING *`);
    const runs = leased.filter((r: any) => !handled.has(r.id));
    if (!runs.length) break;
  for (const run of runs) {
    handled.add(run.id);
    // Out of time before this run's turn: every one of its results stays unasked (the lease goes back, next tick).
    if (Date.now() >= passDeadline) {
      const waiting = Array.isArray(run.tasks) ? run.tasks.length : 0;
      unasked += waiting;
      if (waiting && run.started_at && (!oldestUnasked || new Date(run.started_at) < new Date(oldestUnasked))) oldestUnasked = run.started_at;
      await pool.query("UPDATE seo_rank_runs SET lease_until=NULL WHERE id=$1", [run.id]).catch(() => {});
      continue;
    }
    try {
      const { rows: [site] } = await pool.query("SELECT domain, business_name FROM seo_sites WHERE id=$1", [run.site_id]);
      const competitors = await trackedCompetitors(run.site_id).catch(() => [] as string[]);
      const tasks: PostedRankTask[] = Array.isArray(run.tasks) ? run.tasks : [];
      const pending: PostedRankTask[] = [];
      const failures: string[] = [];
      let written = 0;
      // Results for keywords removed while their check was in the queue: nothing to save, and no longer asked for.
      let discarded = 0;
      // Every task is asked for, in order, while the pass has time; the ones not reached are `rest` (unasked).
      let rest: PostedRankTask[] = [];
      for (let i = 0; i < tasks.length; i += TASK_GET_CONCURRENCY) {
        if (Date.now() >= passDeadline) { rest = tasks.slice(i); break; }
        const chunk = tasks.slice(i, i + TASK_GET_CONCURRENCY);
        const settled = await Promise.allSettled(chunk.map((t) => seoJobDeps.serpTaskGet({ taskId: t.taskId, keywordId: t.keywordId, keyword: t.keyword, targetDomain: site?.domain ?? "", businessName: site?.business_name ?? null, competitors })));
        for (let j = 0; j < chunk.length; j++) {
          const t = chunk[j], r = settled[j];
          if (r.status === "rejected") { pending.push(t); continue; }
          if (r.value.status === "pending") { pending.push(t); continue; }
          if (r.value.status === "failed") { console.warn(`[seo] run ${run.id} check failed ${t.keyword} (${t.device}): ${r.value.message}`); failures.push(`${t.keyword} (${t.device})`); continue; }
          const res = r.value.result;
          try {
          await pool.query(
            `INSERT INTO seo_rank_checks(keyword_id,site_id,run_id,checked_on,device,position,url,serp_features,local_position,local_pack,serp_top,rivals)
             VALUES($1,$2,$3,current_date,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT(keyword_id,checked_on,device) DO UPDATE SET position=EXCLUDED.position,url=EXCLUDED.url,serp_features=EXCLUDED.serp_features,run_id=EXCLUDED.run_id,
               local_position=EXCLUDED.local_position,local_pack=EXCLUDED.local_pack,serp_top=EXCLUDED.serp_top,rivals=EXCLUDED.rivals`,
            [t.keywordId, run.site_id, run.id, t.device, res.position, res.url, JSON.stringify(res.serpFeatures), res.localPosition ?? null, JSON.stringify(res.localPack ?? []), JSON.stringify(res.serpTop ?? []), JSON.stringify(res.rivals ?? {})]);
          written++;
          } catch (e: any) {
            // 23503: the keyword was removed while its check was in the queue — drop the result, keep the run going.
            if (e?.code !== "23503") throw e;
            discarded++;
          }
        }
      }
      const remaining = [...pending, ...rest];
      // Past the window the run is closed only when every remaining result was asked for this pass: a paid result
      // that is merely unread (the pass ran out of time) is never thrown away (collect-plan.ts).
      const decision = closeDecision({ remaining: remaining.length, unasked: rest.length, startedAt: run.started_at, now: Date.now() });
      if (rest.length) {
        unasked += rest.length;
        if (run.started_at && (!oldestUnasked || new Date(run.started_at) < new Date(oldestUnasked))) oldestUnasked = run.started_at;
        if (decision.heldOpen) console.warn(`[seo] run ${run.id} is past its window with ${rest.length} result(s) not yet asked for — kept open, not closed unread`);
      }
      const expired = decision.close && decision.expired;
      const errorNote = [run.error, failures.length ? `${failures.length} check(s) failed: ${failures[0]}` : null,
        expired && remaining.length ? `${remaining.length} check(s) never came back from the queue` : null].filter(Boolean).join(" · ") || null;
      if (decision.close) {
        // Paid checks that never came back are refunded (once per run).
        // ...and so are checks the source said it could not do.
        const undelivered = (expired ? remaining.length : 0) + Number(run.failed ?? 0) + failures.length;
        const refund = undelivered ? await refundUnreturned(run, undelivered) : { refunded: 0, owed: 0 };
        const closingNote = [errorNote, refund.refunded ? "their cost was refunded" : refund.owed ? "their cost is owed back and will be refunded" : null].filter(Boolean).join(" — ") || null;
        // How much of the run came back: the lookups it asked for (less any for keywords removed meanwhile) against
        // the results saved. A run short of its total is closed as partial — on the row, and said in its alerts —
        // whether a lookup was never accepted, failed at the source or never came back inside the window.
        const coverage: RunCoverage = { delivered: Number(run.checked ?? 0) + written, expected: Math.max(0, Number(run.total ?? 0) - discarded) };
        // The run is closed and its alerts saved in ONE transaction — what moved since each keyword's check before is
        // worked out inside it — so a run is never done without its alerts (if any of it fails, the run stays open and
        // is closed again on a later tick). They are sent after it commits (or by the delivery retry).
        const ids = await withTransaction(async (db) => {
          const plan = await rankAlertPlan(run.site_id, run.id, db);
          await db.query(
            "UPDATE seo_rank_runs SET status='done', tasks='[]'::jsonb, checked=checked+$2, error=$3, finished_at=now(), lease_until=NULL, alerts_due=false, failed=failed+$4, total=total-$5, partial=$6 WHERE id=$1",
            [run.id, written, closingNote, failures.length, discarded, coverage.delivered < coverage.expected]);
          return saveRankAlerts(db, plan, coverage);
        });
        for (const id of ids) await deliverAlert(id).catch(() => {});
      } else {
        await pool.query("UPDATE seo_rank_runs SET tasks=$2, checked=checked+$3, error=$4, failed=failed+$5, total=total-$6, lease_until=NULL WHERE id=$1",
          [run.id, JSON.stringify(remaining), written, errorNote, failures.length, discarded]);
      }
    } catch (e) {
      await pool.query("UPDATE seo_rank_runs SET lease_until=NULL WHERE id=$1", [run.id]).catch(() => {});
      void recordFailure("job", "SEO rank run collect", e);
    }
  }
    if (Date.now() >= passDeadline || leased.length < LEASE_BATCH) break;
  }
  // Unread results near their window: the issue desk hears about it before anything could be lost.
  const warning = backlogWarning({ unasked, oldestStartedAt: oldestUnasked, now: Date.now(), budgetMs: COLLECT_BUDGET_MS });
  if (warning) { console.warn(`[seo] ${warning}`); void recordFailure("job", "SEO rank collector backlog", new Error(warning), { unasked, oldestStartedAt: oldestUnasked }, "warning"); }
}

/**
 * Refund the customer's share of checks that were paid for and not delivered
 * (never came back, or the source said it failed). Once per run. A refund that
 * cannot be made yet is recorded on the run as owed and retried by retryOwedRefunds.
 * The share is by number of checks: a keyword with a search operator costs more
 * than its share, so the refund can be slightly off for those, never above the charge.
 */
type RefundOutcome = { /** Cents given back now. */ refunded: number; /** Cents recorded on the run as owed, to be given back by retryOwedRefunds. */ owed: number };
async function refundUnreturned(run: { id: string; reservation_id?: string | null; posted?: number | null; cost_usd?: unknown }, undelivered: number): Promise<RefundOutcome> {
  const posted = Number(run.posted ?? 0);
  if (!run.reservation_id || posted <= 0 || undelivered <= 0) return { refunded: 0, owed: 0 };
  const cents = Math.floor(retailCents(Number(run.cost_usd ?? 0)) * Math.min(undelivered, posted) / posted);
  if (cents < 1) return { refunded: 0, owed: 0 };
  try {
    const given = await refundReservation(run.reservation_id, cents, `rank-run:${run.id}`);
    await pool.query("UPDATE seo_rank_runs SET refund_due=0 WHERE id=$1 AND refund_due<>0", [run.id]).catch(() => {});
    return { refunded: given, owed: 0 };
  } catch (e: any) {
    console.warn(`[seo] refund of ${cents}c for run ${run.id} is owed and will be retried: ${e?.message ?? e}`);
    await pool.query("UPDATE seo_rank_runs SET refund_due=$2, refund_tries=1, refund_tried_at=now() WHERE id=$1", [run.id, cents]).catch(() => {});
    return { refunded: 0, owed: cents };
  }
}
/** The customer's line about a refund, on the run's note: made, owed (and coming), or nothing to say. */
const refundNote = (r: RefundOutcome, what: string) => (r.refunded ? ` ${what} were refunded.` : r.owed ? ` ${what} are owed back and will be refunded.` : "");

/**
 * Refunds that could not be made when their run closed (the reservation was not settled yet, or the database failed).
 * Money owed never ages out: every owed refund is tried again until it is made, the one tried longest ago first (so
 * one that keeps failing cannot crowd out the others), and the ones still owed are counted on the admin card.
 */
export async function retryOwedRefunds(): Promise<number> {
  const { rows } = await pool.query("SELECT id, reservation_id, refund_due, refund_tries FROM seo_rank_runs WHERE refund_due > 0 AND reservation_id IS NOT NULL ORDER BY refund_tried_at NULLS FIRST, created_at LIMIT 20");
  let done = 0;
  for (const r of rows) {
    // Counted before the try: a crash during it still moves this run behind the others.
    const tries = Number(r.refund_tries ?? 0) + 1;
    await pool.query("UPDATE seo_rank_runs SET refund_tries=$2, refund_tried_at=now() WHERE id=$1", [r.id, tries]).catch(() => {});
    try {
      await refundReservation(r.reservation_id, Number(r.refund_due), `rank-run:${r.id}`);
      await pool.query("UPDATE seo_rank_runs SET refund_due=0, error=concat_ws(' · ', error, 'the checks that were not delivered were refunded') WHERE id=$1", [r.id]);
      done++;
    } catch (e: any) {
      // Still not settled: next tick. Said in the log now and then (not every minute), never given up.
      if (tries === 10 || tries % 100 === 0) console.warn(`[seo] refund of ${r.refund_due}c for run ${r.id} is still owed after ${tries} tries (it is never given up): ${e?.message ?? e}`);
    }
  }
  return done;
}
/** What is still owed back to customers, for the admin card: how many runs and how much. */
export async function owedRefunds(): Promise<{ runs: number; cents: number; oldest: string | null }> {
  const { rows: [r] } = await pool.query("SELECT count(*)::int n, coalesce(sum(refund_due), 0)::int cents, min(created_at) AS oldest FROM seo_rank_runs WHERE refund_due > 0");
  return { runs: Number(r?.n ?? 0), cents: Number(r?.cents ?? 0), oldest: r?.oldest ? new Date(r.oldest).toISOString() : null };
}

/**
 * Alerts still owed by runs closed under an earlier version (alerts_due: closed first, alerts saved after — a crash
 * or failure in between left them owed; today the two happen in one transaction). Each is raised from the run's own
 * checks when they are still there. When a later check the same day replaced them all, the alerts cannot be worked
 * out: that is written on the run (shown with the check) and logged — the debt is settled either way, never dropped
 * without a word.
 */
export async function settleOwedRankAlerts(): Promise<number> {
  const { rows } = await pool.query("SELECT id, site_id, checked, total, status FROM seo_rank_runs WHERE alerts_due AND status IN ('done','failed') ORDER BY finished_at NULLS FIRST, created_at LIMIT 20").catch(() => ({ rows: [] as any[] }));
  let done = 0;
  for (const r of rows) {
    try {
      const ids = await withTransaction(async (db) => {
        const { rows: [{ n: left }] } = await db.query("SELECT count(*)::int n FROM seo_rank_checks WHERE run_id=$1", [r.id]);
        const saved = Number(r.checked ?? 0);
        const note = saved > 0 && Number(left) === 0 ? "its alerts could not be worked out afterwards: a later check the same day replaced all of its results"
          : saved > 0 && Number(left) < saved ? "some of its results were replaced by a later check the same day, whose own alert covers them" : null;
        await db.query("UPDATE seo_rank_runs SET alerts_due=false, error=CASE WHEN $2::text IS NULL THEN error ELSE concat_ws(' · ', error, $2::text) END WHERE id=$1", [r.id, note]);
        if (note) console.warn(`[seo] run ${r.id} owed alerts: ${note}`);
        const plan = Number(left) > 0 ? await rankAlertPlan(r.site_id, r.id, db) : null;
        return saveRankAlerts(db, plan, { delivered: saved, expected: Number(r.total ?? 0), stopped: r.status === "failed" });
      });
      for (const id of ids) await deliverAlert(id).catch(() => {});
      done++;
    } catch (e: any) {
      console.error(`[seo] run ${r.id}: the alerts it owes could not be settled (tried again next tick): ${e?.message ?? e}`);
      void recordFailure("job", "SEO owed rank alerts", e, { runId: r.id });
    }
  }
  return done;
}

/**
 * Create the automatic runs for sites that are due (owner's plan still includes the tools, DataForSEO connected), at
 * each site's own frequency. A site already checked today (UTC) is not checked again automatically that day.
 */
let unconfiguredSaidAt = 0;
export async function scheduleWeeklyRuns(): Promise<void> {
  // Any frequency: an automatic check is not made on a day (UTC) the site was already checked — by hand or not. "Run
  // check now" itself always runs (it is the customer's own choice, and its price is on the button).
  await pool.query(
    `UPDATE seo_sites SET next_rank_check_at = (current_date + 1)::timestamp AT TIME ZONE 'UTC'
      WHERE next_rank_check_at <= now() AND last_rank_check_at >= current_date::timestamp AT TIME ZONE 'UTC'`).catch(() => {});
  // Due sites are read, not moved: a site's next date moves on in the same transaction that queues its run, so a
  // crash, a failed insert or a failed plan lookup leaves the check due (tried again next tick) instead of skipping
  // it to the next period without a word.
  const { rows: due } = await pool.query(
    `SELECT id, user_id, domain FROM seo_sites WHERE next_rank_check_at<=now() AND EXISTS (SELECT 1 FROM seo_keywords k WHERE k.site_id=seo_sites.id)
      ORDER BY next_rank_check_at LIMIT 100`);
  if (!due.length) return;
  if (!isConfigured()) {
    // Nothing can be checked until the source is set up; the checks wait as due (and run then), said once an hour.
    if (Date.now() - unconfiguredSaidAt > 3_600_000) { unconfiguredSaidAt = Date.now(); console.warn(`[seo] ${due.length} automatic rank check(s) are due but the data source is not configured: they wait`); }
    return;
  }
  const gap = GAP_SQL("coalesce(rank_frequency, 'weekly')");
  for (const s of due) {
    try {
      if (!(await seoJobDeps.entitled(s.user_id))) {
        // The plan no longer includes the tools: this period's check is skipped on purpose (not a failure), and the
        // next period looked at when it comes round.
        await pool.query(`UPDATE seo_sites SET next_rank_check_at=now()+${gap} WHERE id=$1 AND next_rank_check_at<=now()`, [s.id]);
        continue;
      }
      await withTransaction(async (db) => {
        const { rows: [site] } = await db.query("SELECT * FROM seo_sites WHERE id=$1 AND next_rank_check_at<=now() FOR UPDATE SKIP LOCKED", [s.id]);
        if (!site) return; // moved on by another pass meanwhile
        await enqueueRankRun(site, "weekly", db);
        await db.query(`UPDATE seo_sites SET next_rank_check_at=now()+${gap} WHERE id=$1`, [site.id]);
      });
    } catch (e: any) {
      console.error(`[seo] automatic rank check for ${s.domain} could not be queued (it stays due and is tried again): ${e?.message ?? e}`);
      void recordFailure("job", "SEO weekly schedule", e, { siteId: s.id });
    }
  }
}

/** Buy the summary + top backlinks for a site and store today's snapshot. */
/** `automatic`: the monthly job — included data only, never purchased credit. `deadline`: the job's lease deadline (see dataforseo.ts Deadline); nothing is asked of the source after it. */
export type BacklinkSnapshotResult = { id: number; takenOn: string; costUsd: number; /** The lost-backlinks part did not load (the rest did). */ lostFailed: boolean;
  /** Today's snapshot was already taken (by the monthly job or by hand): nothing was bought, and this is that snapshot. */ reused?: boolean };
/**
 * One snapshot per site per day, whoever asks: "Refresh now" and the monthly job take the same per-site lock (in every
 * server process), and whoever gets it second finds today's snapshot and buys nothing — before this, the two could both
 * buy on the same day and the day's row summed both charges for one snapshot.
 */
export async function snapshotBacklinks(site: SiteRow, automatic = false, deadline?: Deadline): Promise<BacklinkSnapshotResult> {
  return seoLocks.withLock(`backlinks-snapshot:${site.id}`, async () => {
    const { rows: [today] } = await pool.query(
      "SELECT id, taken_on::text AS taken_on, changes FROM seo_backlink_snapshots WHERE site_id=$1 AND taken_on = current_date", [site.id]);
    if (today) {
      // The monthly job's period closes with the snapshot it found (a refresh by hand already moved it; this is a no-op then).
      if (automatic) await pool.query("UPDATE seo_sites SET next_backlinks_at=now()+interval '1 month' WHERE id=$1", [site.id]);
      return { id: Number(today.id), takenOn: String(today.taken_on).slice(0, 10), costUsd: 0, lostFailed: today.changes?.failed === true, reused: true };
    }
    return buySnapshot(site, automatic, deadline);
  });
}
async function buySnapshot(site: SiteRow, automatic: boolean, deadline?: Deadline): Promise<BacklinkSnapshotResult> {
  // With an earlier snapshot to compare with, the linking sites lost since then are named too (one more lookup).
  const { rows: [before] } = await pool.query("SELECT taken_on::text AS taken_on FROM seo_backlink_snapshots WHERE site_id=$1 AND taken_on < current_date ORDER BY taken_on DESC LIMIT 1", [site.id]);
  const estimate = estimateBacklinkSnapshotUsd(BACKLINK_ROWS) + (before ? estimateLostLinksUsd() : 0);
  const out = await withBudget(site.user_id, estimate, async () => {
    const summary = await seoJobDeps.backlinksSummary({ target: site.domain, deadline });
    // What the customer pays for: the parts that arrived.
    let delivered = summary.costUsd;
    let list: Awaited<ReturnType<typeof backlinksList>> | null = null, listUnknown = false;
    // A lookup never sent (the deadline had passed) cost nothing for certain: it is not an unknown.
    const unknown = (e: any) => e?.costUnknown !== false && (e?.code === "timeout" || (e?.code === "upstream" && !(e?.costUsd > 0)));
    try { list = await seoJobDeps.backlinksList({ target: site.domain, limit: BACKLINK_ROWS, deadline }); delivered += list.costUsd; }
    catch (e: any) {
      summary.costUsd += typeof e?.costUsd === "number" ? e.costUsd : 0;
      if (unknown(e)) listUnknown = true;
      console.warn(`[seo] backlinks list failed for ${site.domain}: ${e?.message}`);
    }
    // Lost backlinks seen since the last snapshot. Always asked for when there is an earlier snapshot (the summary's own
    // "lost" count covers a different period, so it cannot say there are none); a failure is recorded as a failure.
    let changes: { since: string; lost: LostLink[]; lostTotal: number | null; failed?: true } | null = null, lostCost = 0;
    if (before) {
      try { const l = await seoJobDeps.lostLinks({ target: site.domain, since: before.taken_on, limit: LOST_LINK_ROWS, deadline }); lostCost = l.costUsd; delivered += l.costUsd; changes = { since: before.taken_on, lost: l.data.items, lostTotal: l.data.total }; }
      catch (e: any) {
        lostCost = typeof e?.costUsd === "number" ? e.costUsd : 0;
        if (unknown(e)) listUnknown = true;
        console.warn(`[seo] lost links failed for ${site.domain}: ${e?.message}`);
        changes = { since: before.taken_on, lost: [], lostTotal: null, failed: true };
      }
    }
    const costUsd = summary.costUsd + (list?.costUsd ?? 0) + lostCost;
    // Saved BEFORE it is charged: if the snapshot cannot be written this throws, the lookup counts as failed and the
    // customer pays nothing — so a snapshot is never paid for and then missing (and bought again on the next try).
    // The snapshot and the schedule move together, in one transaction: a snapshot that is saved has always closed its
    // period, so a later pass cannot find the site still "due" and buy the same month again.
    let row: any;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      ({ rows: [row] } = await client.query(
        `INSERT INTO seo_backlink_snapshots(site_id,user_id,taken_on,summary,backlinks,cost_usd,changes) VALUES($1,$2,current_date,$3,$4,$5,$6)
         ON CONFLICT(site_id,taken_on) DO UPDATE SET summary=EXCLUDED.summary,backlinks=EXCLUDED.backlinks,cost_usd=seo_backlink_snapshots.cost_usd+EXCLUDED.cost_usd,
           changes=EXCLUDED.changes, alerts_done=false, alerts_tried_at=NULL
         RETURNING id, taken_on::text AS taken_on`,
        [site.id, site.user_id, JSON.stringify({ ...summary.data, totalCount: list?.data.totalCount ?? null, listFailed: !list }), JSON.stringify(list?.data.items ?? []), costUsd, changes ? JSON.stringify(changes) : null]));
      await client.query("UPDATE seo_sites SET last_backlinks_at=now(), next_backlinks_at=now()+interval '1 month' WHERE id=$1", [site.id]);
      await client.query("COMMIT");
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      throw Object.assign(new Error(`backlink snapshot for ${site.domain} could not be saved: ${e?.message ?? e}`), { costUsd, costUnknown: listUnknown, notSaved: true });
    } finally { client.release(); }
    return { data: { id: row.id as number, takenOn: String(row.taken_on).slice(0, 10), changes }, costUsd, customerUsd: delivered, costUnknown: listUnknown };
  }, { allowanceOnly: automatic, label: `Backlink snapshot — ${site.domain} (${automatic ? "monthly" : "refresh"})` });
  await settleLinkAlerts(site.id);
  return { id: out.data.id, takenOn: out.data.takenOn, costUsd: out.costUsd, lostFailed: out.data.changes?.failed === true };
}

async function runDueBacklinkSnapshots(): Promise<void> {
  // Alerts still owed for snapshots already taken (the alert step failed, or the process stopped before it): saved rows
  // only. The ones tried longest ago come first, so a site that keeps failing cannot crowd out the others; nothing expires.
  const { rows: owed } = await pool.query(
    "SELECT site_id FROM seo_backlink_snapshots WHERE alerts_done = false GROUP BY site_id ORDER BY min(alerts_tried_at) NULLS FIRST, site_id LIMIT 10").catch(() => ({ rows: [] as any[] }));
  for (const o of owed) await settleLinkAlerts(o.site_id);
  if (!isConfigured()) return;
  // Leased for six hours, not moved on a month: if the snapshot cannot be bought or saved, it is tried again later
  // today. The month moves on in the same transaction that saves the snapshot (snapshotBacklinks).
  // A later pass leases the site again once the lease runs out, and the checks around a request cannot stop one
  // already in flight: so this pass asks the source nothing after a request's full timeout, plus a margin, before that.
  const leasedAt = Date.now();
  const { rows: due } = await pool.query(
    `UPDATE seo_sites SET next_backlinks_at=now()+interval '${BACKLINKS_LEASE_HOURS} hours' WHERE next_backlinks_at<=now() AND last_backlinks_at IS NOT NULL RETURNING *`);
  const deadline = claimDeadline(leasedAt, BACKLINKS_LEASE_HOURS * 3600_000);
  for (const site of due) {
    try {
      const ent = await getEntitlements(site.user_id);
      if (!seoIncluded(ent)) { await pool.query("UPDATE seo_sites SET next_backlinks_at=now()+interval '1 day' WHERE id=$1", [site.id]); continue; }
      await snapshotBacklinks(site, true, deadline);
    } catch (e) {
      if (!(e instanceof SeoBudgetError)) void recordFailure("job", "SEO backlink snapshot", e);
      else {
        // Out of included data: nothing more is likely today.
        console.warn(`[seo] backlink snapshot for ${site.domain} skipped: ${e.message}`);
        await pool.query("UPDATE seo_sites SET next_backlinks_at=now()+interval '1 day' WHERE id=$1", [site.id]).catch(() => {});
      }
    }
  }
}

/**
 * Raise the link alerts each of a site's unsettled snapshots calls for — each compared with the snapshot before IT,
 * oldest first — and mark exactly that snapshot as dealt with. A snapshot saved meanwhile is not touched.
 */
async function settleLinkAlerts(siteId: number): Promise<void> {
  // The time of this try doubles as the snapshot's version: a refresh on the same day rewrites the row and clears it,
  // so the settlement below cannot mark a rewritten snapshot as dealt with on the strength of the one it replaced.
  const { rows } = await pool.query("UPDATE seo_backlink_snapshots SET alerts_tried_at = clock_timestamp() WHERE site_id=$1 AND alerts_done = false RETURNING id, taken_on::text AS taken_on, alerts_tried_at::text AS tried", [siteId]).catch(() => ({ rows: [] as any[] }));
  for (const snap of rows.sort((a: any, b: any) => String(a.taken_on).localeCompare(String(b.taken_on)))) {
    try {
      await raiseLinkAlerts(siteId, snap.taken_on);
      await pool.query("UPDATE seo_backlink_snapshots SET alerts_done = true WHERE id=$1 AND alerts_tried_at = $2::timestamptz", [snap.id, snap.tried]);
    } catch (e: any) { console.error(`[seo] link alerts for site ${siteId} (snapshot of ${snap.taken_on}) failed (they will be tried again): ${e?.message ?? e}`); }
  }
}

/** One scheduler pass; only one instance at a time across processes. */
export async function seoTick(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows: [{ locked }] } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_KEY]);
    if (!locked) return;
    try {
      await reconcileReservations().catch((e) => console.error("[seo] reconcile failed", e?.message ?? e));
      await scheduleWeeklyRuns();
      for (let i = 0; i < 10 && (await postQueuedRun()); i++) { /* post up to 10 queued runs per tick */ }
      await collectRunningRuns();
      await settleOwedRankAlerts().catch((e) => console.error("[seo] owed rank alerts failed", e?.message ?? e));
      await retryOwedRefunds().catch((e) => console.error("[seo] owed refunds failed", e?.message ?? e));
      await deliverPendingAlerts().catch((e) => console.error("[seo] alert delivery failed", e?.message ?? e));
      await runDueAiChecks().catch((e) => console.error("[seo] monthly AI questions failed", e?.message ?? e));
      await sendDueReports().catch((e) => console.error("[seo] scheduled reports failed", e?.message ?? e));
      await runDueBacklinkSnapshots();
      await runDueKeywordSnapshots().catch((e) => console.error("[seo] keyword snapshots failed", e?.message ?? e));
      await runDueMentionChecks().catch((e) => console.error("[seo] mentions watch failed", e?.message ?? e));
      // A scan takes a minute or two, so it is started here and left to finish on its own (it leases its watch, the
      // database allows one running scan per site, and it never runs two passes at once).
      void runDueGridWatches().catch((e) => console.error("[seo] repeating grids failed", e?.message ?? e));
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

export function startSeoWorker() {
  if (process.env.SEO_JOBS_DISABLED === "true") return;
  const timer = setInterval(() => void seoTick().catch((e) => { console.error("[seo] tick failed", e?.message ?? e); void recordFailure("job", "SEO tick", e); }), TICK_MS);
  timer.unref();
  return timer;
}
