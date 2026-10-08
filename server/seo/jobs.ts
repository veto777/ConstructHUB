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
import { isConfigured, serpTaskPost, serpTaskGet, backlinksSummary, backlinksList, MAX_TASKS_PER_POST, type PostedRankTask, type Device, lostLinks, type LostLink } from "./dataforseo";
import { estimateRankCheckUsd, estimateBacklinkSnapshotUsd, devicesOf, serpUsd, type DeviceSet, estimateLostLinksUsd, LOST_LINK_ROWS } from "./pricing";
import { seoIncluded, SEO_NOT_READY_MESSAGE } from "./plan";
import { raiseRankAlerts, raiseLinkAlerts } from "./alerts";
import { publicFailure } from "./public-errors";

const TICK_MS = 60_000;
const LOCK_KEY = 7192;
/** Standard-queue tasks finish in ~5 minutes on average; after this a run closes with what it has. */
const RUN_WINDOW_MS = 90 * 60_000;
const TASK_GETS_PER_TICK = 300;
const TASK_GET_CONCURRENCY = 10;
export const BACKLINK_ROWS = 100;
export const WEEKLY_SKIPPED_MESSAGE = "This month's included SEO data is used up, so the automatic weekly check was skipped. Automatic checks never spend credit you bought — press Run check now to use it.";

export type SiteRow = { id: number; user_id: number; domain: string; location_code: number; language_code: string; devices: DeviceSet; serp_depth: number; business_name?: string | null; alerts_enabled?: boolean; alert_drop?: number; next_rank_check_at?: Date; next_backlinks_at?: Date; last_rank_check_at?: Date | null; last_backlinks_at?: Date | null; created_at?: Date };

export const seoJobDeps = { serpTaskPost, serpTaskGet, backlinksSummary, backlinksList, lostLinks };

/** Queue a rank-check run for a site (reuses one already queued/running). */
export async function enqueueRankRun(site: SiteRow, trigger: "weekly" | "manual"): Promise<{ id: string; reused: boolean }> {
  const { rows: [open] } = await pool.query(
    "SELECT id FROM seo_rank_runs WHERE site_id=$1 AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1", [site.id]);
  if (open) return { id: open.id, reused: true };
  const id = randomUUID();
  try {
    await pool.query("INSERT INTO seo_rank_runs(id,site_id,user_id,trigger) VALUES($1,$2,$3,$4)", [id, site.id, site.user_id, trigger]);
  } catch (e: any) {
    // seo_rank_runs_one_active: another request queued this site's run between the check and the insert.
    if (e?.code !== "23505") throw e;
    const { rows: [other] } = await pool.query("SELECT id FROM seo_rank_runs WHERE site_id=$1 AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1", [site.id]);
    if (!other) throw e;
    return { id: other.id, reused: true };
  }
  return { id, reused: false };
}

/** Lease one queued run and post its tasks. Returns false when nothing was queued. */
export async function postQueuedRun(runId?: string): Promise<boolean> {
  const { rows: [run] } = await pool.query(
    `UPDATE seo_rank_runs SET status='running', started_at=now(), lease_until=now()+interval '5 minutes'
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
      reservation = await reserveBudget(run.user_id, estimate.usd, { allowanceOnly: run.trigger === "weekly", label: `Rank check — ${keywords.length} keyword${keywords.length === 1 ? "" : "s"} for ${site.domain} (${run.trigger === "weekly" ? "weekly" : "run now"})` });
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
        const out = await seoJobDeps.serpTaskPost({ tasks: chunk, locationCode: site.location_code, languageCode: site.language_code, depth: site.serp_depth, targetDomain: site.domain });
        posted.push(...out.data);
        costUsd += out.costUsd;
        // Saved chunk by chunk: a crash mid-posting must not lose task ids that were already paid for.
        await pool.query("UPDATE seo_rank_runs SET tasks=$2, posted=$3, cost_usd=$4, lease_until=now()+interval '5 minutes' WHERE id=$1", [run.id, JSON.stringify(posted), posted.length, costUsd]);
      } catch (e: any) {
        firstError ??= e?.message ?? String(e);
        costUsd += typeof e?.costUsd === "number" ? e.costUsd : 0;
        if (e?.code === "timeout" || (e?.code === "upstream" && !(e?.costUsd > 0))) unknownUsd += chunk.reduce((a, t) => a + serpUsd(site.serp_depth, "standard", t.keyword), 0);
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
    `SELECT id, reservation_id, posted, cost_usd, failed, jsonb_array_length(tasks) AS waiting FROM seo_rank_runs
      WHERE (status='running' AND started_at < now() - interval '3 hours') OR (status='queued' AND created_at < now() - interval '24 hours')
      FOR UPDATE SKIP LOCKED LIMIT 20`).catch(() => ({ rows: [] as any[] }));
  for (const s of stuck) {
    const refunded = await refundUnreturned(s, Number(s.waiting ?? 0) + Number(s.failed ?? 0));
    await pool.query(
      `UPDATE seo_rank_runs SET status='failed', finished_at=now(), lease_until=NULL, tasks='[]'::jsonb, error=concat_ws(' · ', error, $2::text) WHERE id=$1`,
      [s.id, `The check stopped before it finished.${refunded ? " The checks that never came back were refunded." : ""}`]).catch(() => {});
  }
  const { rows: runs } = await pool.query(
    `UPDATE seo_rank_runs SET lease_until=now()+interval '5 minutes'
     WHERE id IN (SELECT id FROM seo_rank_runs WHERE status='running' AND (lease_until IS NULL OR lease_until<now()) ORDER BY started_at FOR UPDATE SKIP LOCKED LIMIT 20)
     RETURNING *`);
  let budget = TASK_GETS_PER_TICK;
  for (const run of runs) {
    try {
      const { rows: [site] } = await pool.query("SELECT domain, business_name FROM seo_sites WHERE id=$1", [run.site_id]);
      const competitors = await trackedCompetitors(run.site_id).catch(() => [] as string[]);
      const tasks: PostedRankTask[] = Array.isArray(run.tasks) ? run.tasks : [];
      const pending: PostedRankTask[] = [];
      const failures: string[] = [];
      let written = 0;
      const batch = tasks.slice(0, budget);
      const rest = tasks.slice(budget);
      budget -= batch.length;
      for (let i = 0; i < batch.length; i += TASK_GET_CONCURRENCY) {
        const chunk = batch.slice(i, i + TASK_GET_CONCURRENCY);
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
          }
        }
      }
      const remaining = [...pending, ...rest];
      const expired = run.started_at && Date.now() - new Date(run.started_at).getTime() > RUN_WINDOW_MS;
      const errorNote = [run.error, failures.length ? `${failures.length} check(s) failed: ${failures[0]}` : null,
        expired && remaining.length ? `${remaining.length} check(s) never came back from the queue` : null].filter(Boolean).join(" · ") || null;
      if (!remaining.length || expired) {
        // Paid checks that never came back are refunded (once per run).
        // ...and so are checks the source said it could not do.
        const undelivered = (expired ? remaining.length : 0) + Number(run.failed ?? 0) + failures.length;
        const refunded = undelivered ? await refundUnreturned(run, undelivered) : 0;
        const closingNote = refunded ? [errorNote, "their cost was refunded"].filter(Boolean).join(" — ") : errorNote;
        await pool.query(
          "UPDATE seo_rank_runs SET status='done', tasks='[]'::jsonb, checked=checked+$2, error=$3, finished_at=now(), lease_until=NULL WHERE id=$1",
          [run.id, written, closingNote]);
        if (failures.length) await pool.query("UPDATE seo_rank_runs SET failed=failed+$2 WHERE id=$1", [run.id, failures.length]).catch(() => {});
        // The run is complete: tell the owner what moved since the check before it.
        await raiseRankAlerts(run.site_id, run.id).catch((e: any) => console.error(`[seo] alerts for run ${run.id} failed: ${e?.message ?? e}`));
      } else {
        await pool.query("UPDATE seo_rank_runs SET tasks=$2, checked=checked+$3, error=$4, failed=failed+$5, lease_until=NULL WHERE id=$1",
          [run.id, JSON.stringify(remaining), written, errorNote, failures.length]);
      }
    } catch (e) {
      await pool.query("UPDATE seo_rank_runs SET lease_until=NULL WHERE id=$1", [run.id]).catch(() => {});
      void recordFailure("job", "SEO rank run collect", e);
    }
  }
}

/**
 * Refund the customer's share of checks that were paid for and not delivered
 * (never came back, or the source said it failed). Once per run. A refund that
 * cannot be made yet is recorded on the run as owed and retried by retryOwedRefunds.
 * The share is by number of checks: a keyword with a search operator costs more
 * than its share, so the refund can be slightly off for those, never above the charge.
 */
async function refundUnreturned(run: { id: string; reservation_id?: string | null; posted?: number | null; cost_usd?: unknown }, undelivered: number): Promise<number> {
  const posted = Number(run.posted ?? 0);
  if (!run.reservation_id || posted <= 0 || undelivered <= 0) return 0;
  const cents = Math.floor(retailCents(Number(run.cost_usd ?? 0)) * Math.min(undelivered, posted) / posted);
  if (cents < 1) return 0;
  try {
    const given = await refundReservation(run.reservation_id, cents, `rank-run:${run.id}`);
    await pool.query("UPDATE seo_rank_runs SET refund_due=0 WHERE id=$1 AND refund_due<>0", [run.id]).catch(() => {});
    return given;
  } catch (e: any) {
    console.warn(`[seo] refund of ${cents}c for run ${run.id} is owed and will be retried: ${e?.message ?? e}`);
    await pool.query("UPDATE seo_rank_runs SET refund_due=$2 WHERE id=$1", [run.id, cents]).catch(() => {});
    return 0;
  }
}

/** Refunds that could not be made when their run closed (the reservation was not settled yet, or the database failed). */
export async function retryOwedRefunds(): Promise<number> {
  const { rows } = await pool.query("SELECT id, reservation_id, refund_due FROM seo_rank_runs WHERE refund_due > 0 AND reservation_id IS NOT NULL AND created_at > now() - interval '14 days' ORDER BY created_at LIMIT 20");
  let done = 0;
  for (const r of rows) {
    try {
      await refundReservation(r.reservation_id, Number(r.refund_due), `rank-run:${r.id}`);
      await pool.query("UPDATE seo_rank_runs SET refund_due=0, error=concat_ws(' · ', error, 'the checks that were not delivered were refunded') WHERE id=$1", [r.id]);
      done++;
    } catch { /* still not settled: next tick */ }
  }
  return done;
}

/** Create the weekly runs for sites that are due (owner's plan still includes the tools, DataForSEO connected). */
export async function scheduleWeeklyRuns(): Promise<void> {
  const { rows: due } = await pool.query(
    `UPDATE seo_sites SET next_rank_check_at=now()+interval '7 days'
     WHERE next_rank_check_at<=now() AND EXISTS (SELECT 1 FROM seo_keywords k WHERE k.site_id=seo_sites.id)
     RETURNING *`);
  if (!due.length || !isConfigured()) return;
  for (const site of due) {
    try {
      const ent = await getEntitlements(site.user_id);
      if (!seoIncluded(ent)) continue;
      await enqueueRankRun(site, "weekly");
    } catch (e) { void recordFailure("job", "SEO weekly schedule", e); }
  }
}

/** Buy the summary + top backlinks for a site and store today's snapshot. */
/** `automatic`: the monthly job — included data only, never purchased credit. */
export async function snapshotBacklinks(site: SiteRow, automatic = false): Promise<{ id: number; takenOn: string; costUsd: number; /** The lost-backlinks part did not load (the rest did). */ lostFailed: boolean }> {
  // With an earlier snapshot to compare with, the linking sites lost since then are named too (one more lookup).
  const { rows: [before] } = await pool.query("SELECT taken_on::text AS taken_on FROM seo_backlink_snapshots WHERE site_id=$1 AND taken_on < current_date ORDER BY taken_on DESC LIMIT 1", [site.id]);
  const estimate = estimateBacklinkSnapshotUsd(BACKLINK_ROWS) + (before ? estimateLostLinksUsd() : 0);
  const out = await withBudget(site.user_id, estimate, async () => {
    const summary = await seoJobDeps.backlinksSummary({ target: site.domain });
    // What the customer pays for: the parts that arrived.
    let delivered = summary.costUsd;
    let list: Awaited<ReturnType<typeof backlinksList>> | null = null, listUnknown = false;
    try { list = await seoJobDeps.backlinksList({ target: site.domain, limit: BACKLINK_ROWS }); delivered += list.costUsd; }
    catch (e: any) {
      summary.costUsd += typeof e?.costUsd === "number" ? e.costUsd : 0;
      if (e?.code === "timeout" || (e?.code === "upstream" && !(e?.costUsd > 0))) listUnknown = true;
      console.warn(`[seo] backlinks list failed for ${site.domain}: ${e?.message}`);
    }
    // Lost backlinks seen since the last snapshot. Always asked for when there is an earlier snapshot (the summary's own
    // "lost" count covers a different period, so it cannot say there are none); a failure is recorded as a failure.
    let changes: { since: string; lost: LostLink[]; lostTotal: number | null; failed?: true } | null = null, lostCost = 0;
    if (before) {
      try { const l = await seoJobDeps.lostLinks({ target: site.domain, since: before.taken_on, limit: LOST_LINK_ROWS }); lostCost = l.costUsd; delivered += l.costUsd; changes = { since: before.taken_on, lost: l.data.items, lostTotal: l.data.total }; }
      catch (e: any) {
        lostCost = typeof e?.costUsd === "number" ? e.costUsd : 0;
        if (e?.code === "timeout" || (e?.code === "upstream" && !(e?.costUsd > 0))) listUnknown = true;
        console.warn(`[seo] lost links failed for ${site.domain}: ${e?.message}`);
        changes = { since: before.taken_on, lost: [], lostTotal: null, failed: true };
      }
    }
    const costUsd = summary.costUsd + (list?.costUsd ?? 0) + lostCost;
    // Saved BEFORE it is charged: if the snapshot cannot be written this throws, the lookup counts as failed and the
    // customer pays nothing — so a snapshot is never paid for and then missing (and bought again on the next try).
    let row: any;
    try {
      ({ rows: [row] } = await pool.query(
        `INSERT INTO seo_backlink_snapshots(site_id,user_id,taken_on,summary,backlinks,cost_usd,changes) VALUES($1,$2,current_date,$3,$4,$5,$6)
         ON CONFLICT(site_id,taken_on) DO UPDATE SET summary=EXCLUDED.summary,backlinks=EXCLUDED.backlinks,cost_usd=seo_backlink_snapshots.cost_usd+EXCLUDED.cost_usd,
           changes=EXCLUDED.changes
         RETURNING id, taken_on::text AS taken_on`,
        [site.id, site.user_id, JSON.stringify({ ...summary.data, totalCount: list?.data.totalCount ?? null, listFailed: !list }), JSON.stringify(list?.data.items ?? []), costUsd, changes ? JSON.stringify(changes) : null]));
    } catch (e: any) { throw Object.assign(new Error(`backlink snapshot for ${site.domain} could not be saved: ${e?.message ?? e}`), { costUsd, costUnknown: listUnknown, notSaved: true }); }
    return { data: { id: row.id as number, takenOn: String(row.taken_on).slice(0, 10), changes }, costUsd, customerUsd: delivered, costUnknown: listUnknown };
  }, { allowanceOnly: automatic, label: `Backlink snapshot — ${site.domain} (${automatic ? "monthly" : "refresh"})` });
  await pool.query("UPDATE seo_sites SET last_backlinks_at=now(), next_backlinks_at=now()+interval '1 month' WHERE id=$1", [site.id]);
  await raiseLinkAlerts(site.id).catch((e: any) => console.error(`[seo] link alerts for ${site.domain} failed: ${e?.message ?? e}`));
  return { id: out.data.id, takenOn: out.data.takenOn, costUsd: out.costUsd, lostFailed: out.data.changes?.failed === true };
}

async function runDueBacklinkSnapshots(): Promise<void> {
  if (!isConfigured()) return;
  const { rows: due } = await pool.query(
    `UPDATE seo_sites SET next_backlinks_at=now()+interval '1 month' WHERE next_backlinks_at<=now() AND last_backlinks_at IS NOT NULL RETURNING *`);
  for (const site of due) {
    try {
      const ent = await getEntitlements(site.user_id);
      if (!seoIncluded(ent)) continue;
      await snapshotBacklinks(site, true);
    } catch (e) {
      if (!(e instanceof SeoBudgetError)) void recordFailure("job", "SEO backlink snapshot", e);
      else console.warn(`[seo] backlink snapshot for ${site.domain} skipped: ${e.message}`);
    }
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
      await retryOwedRefunds().catch((e) => console.error("[seo] owed refunds failed", e?.message ?? e));
      await deliverPendingAlerts().catch((e) => console.error("[seo] alert delivery failed", e?.message ?? e));
      await runDueAiChecks().catch((e) => console.error("[seo] monthly AI questions failed", e?.message ?? e));
      await sendDueReports().catch((e) => console.error("[seo] scheduled reports failed", e?.message ?? e));
      await runDueBacklinkSnapshots();
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
