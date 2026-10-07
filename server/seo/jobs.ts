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
import { reserveBudget, settleBudget, withBudget, SeoBudgetError } from "./budget";
import { isConfigured, serpTaskPost, serpTaskGet, backlinksSummary, backlinksList, MAX_TASKS_PER_POST, type PostedRankTask, type Device } from "./dataforseo";
import { estimateRankCheckUsd, estimateBacklinkSnapshotUsd, devicesOf, type DeviceSet } from "./pricing";
import { seoIncluded, SEO_NOT_READY_MESSAGE } from "./plan";

const TICK_MS = 60_000;
const LOCK_KEY = 7192;
/** Standard-queue tasks finish in ~5 minutes on average; after this a run closes with what it has. */
const RUN_WINDOW_MS = 90 * 60_000;
const TASK_GETS_PER_TICK = 300;
const TASK_GET_CONCURRENCY = 10;
export const BACKLINK_ROWS = 100;

export type SiteRow = { id: number; user_id: number; domain: string; location_code: number; language_code: string; devices: DeviceSet; serp_depth: number; next_rank_check_at?: Date; next_backlinks_at?: Date; last_rank_check_at?: Date | null; last_backlinks_at?: Date | null; created_at?: Date };

export const seoJobDeps = { serpTaskPost, serpTaskGet, backlinksSummary, backlinksList };

/** Queue a rank-check run for a site (reuses one already queued/running). */
export async function enqueueRankRun(site: SiteRow, trigger: "weekly" | "manual"): Promise<{ id: string; reused: boolean }> {
  const { rows: [open] } = await pool.query(
    "SELECT id FROM seo_rank_runs WHERE site_id=$1 AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1", [site.id]);
  if (open) return { id: open.id, reused: true };
  const id = randomUUID();
  await pool.query("INSERT INTO seo_rank_runs(id,site_id,user_id,trigger) VALUES($1,$2,$3,$4)", [id, site.id, site.user_id, trigger]);
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
    const { rows: keywords } = await pool.query("SELECT id, keyword FROM seo_keywords WHERE site_id=$1 ORDER BY id", [run.site_id]);
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
    const inputs = keywords.flatMap((k: any) => devices.map((device) => ({ keyword: k.keyword, keywordId: k.id, device: device as Device })));
    const estimate = estimateRankCheckUsd(keywords.map((k: any) => k.keyword), site.devices, site.serp_depth);
    let reservation;
    try {
      reservation = await reserveBudget(run.user_id, estimate.usd);
    } catch (e) {
      if (e instanceof SeoBudgetError) { console.warn(`[seo] run ${run.id} refused: ${e.detail}`); await finishRun(run.id, "failed", e.message); return true; }
      throw e;
    }
    const posted: PostedRankTask[] = [];
    let costUsd = 0;
    let firstError: string | null = null;
    for (let i = 0; i < inputs.length; i += MAX_TASKS_PER_POST) {
      const chunk = inputs.slice(i, i + MAX_TASKS_PER_POST);
      try {
        const out = await seoJobDeps.serpTaskPost({ tasks: chunk, locationCode: site.location_code, languageCode: site.language_code, depth: site.serp_depth, targetDomain: site.domain });
        posted.push(...out.data);
        costUsd += out.costUsd;
      } catch (e: any) {
        firstError ??= e?.message ?? String(e);
        costUsd += typeof e?.costUsd === "number" ? e.costUsd : 0;
        console.warn(`[seo] run ${run.id} task_post chunk ${i / MAX_TASKS_PER_POST} failed: ${firstError}`);
        firstError = "Some checks were not accepted by the search data service.";
      }
    }
    await settleBudget(reservation, costUsd);
    if (!posted.length) {
      await finishRun(run.id, "failed", firstError ?? "DataForSEO accepted none of the tasks", costUsd);
      return true;
    }
    await pool.query(
      "UPDATE seo_rank_runs SET tasks=$2, total=$3, cost_usd=$4, error=$5, lease_until=NULL WHERE id=$1",
      [run.id, JSON.stringify(posted), inputs.length, costUsd, posted.length < inputs.length ? `${inputs.length - posted.length} of ${inputs.length} checks were not accepted by the search data service` : null]);
    await pool.query("UPDATE seo_sites SET last_rank_check_at=now() WHERE id=$1", [site.id]);
  } catch (e: any) {
    await finishRun(run.id, "failed", e?.message ?? String(e));
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
  const { rows: runs } = await pool.query(
    `UPDATE seo_rank_runs SET lease_until=now()+interval '5 minutes'
     WHERE id IN (SELECT id FROM seo_rank_runs WHERE status='running' AND (lease_until IS NULL OR lease_until<now()) ORDER BY started_at FOR UPDATE SKIP LOCKED LIMIT 20)
     RETURNING *`);
  let budget = TASK_GETS_PER_TICK;
  for (const run of runs) {
    try {
      const { rows: [site] } = await pool.query("SELECT domain FROM seo_sites WHERE id=$1", [run.site_id]);
      const tasks: PostedRankTask[] = Array.isArray(run.tasks) ? run.tasks : [];
      const pending: PostedRankTask[] = [];
      const failures: string[] = [];
      let written = 0;
      const batch = tasks.slice(0, budget);
      const rest = tasks.slice(budget);
      budget -= batch.length;
      for (let i = 0; i < batch.length; i += TASK_GET_CONCURRENCY) {
        const chunk = batch.slice(i, i + TASK_GET_CONCURRENCY);
        const settled = await Promise.allSettled(chunk.map((t) => seoJobDeps.serpTaskGet({ taskId: t.taskId, keywordId: t.keywordId, keyword: t.keyword, targetDomain: site?.domain ?? "" })));
        for (let j = 0; j < chunk.length; j++) {
          const t = chunk[j], r = settled[j];
          if (r.status === "rejected") { pending.push(t); continue; }
          if (r.value.status === "pending") { pending.push(t); continue; }
          if (r.value.status === "failed") { console.warn(`[seo] run ${run.id} check failed ${t.keyword} (${t.device}): ${r.value.message}`); failures.push(`${t.keyword} (${t.device})`); continue; }
          const res = r.value.result;
          await pool.query(
            `INSERT INTO seo_rank_checks(keyword_id,site_id,run_id,checked_on,device,position,url,serp_features)
             VALUES($1,$2,$3,current_date,$4,$5,$6,$7)
             ON CONFLICT(keyword_id,checked_on,device) DO UPDATE SET position=EXCLUDED.position,url=EXCLUDED.url,serp_features=EXCLUDED.serp_features,run_id=EXCLUDED.run_id`,
            [t.keywordId, run.site_id, run.id, t.device, res.position, res.url, JSON.stringify(res.serpFeatures)]);
          written++;
        }
      }
      const remaining = [...pending, ...rest];
      const expired = run.started_at && Date.now() - new Date(run.started_at).getTime() > RUN_WINDOW_MS;
      const errorNote = [run.error, failures.length ? `${failures.length} check(s) failed: ${failures[0]}` : null,
        expired && remaining.length ? `${remaining.length} check(s) never came back from the queue` : null].filter(Boolean).join(" · ") || null;
      if (!remaining.length || expired) {
        await pool.query(
          "UPDATE seo_rank_runs SET status='done', tasks='[]'::jsonb, checked=checked+$2, error=$3, finished_at=now(), lease_until=NULL WHERE id=$1",
          [run.id, written, errorNote]);
      } else {
        await pool.query("UPDATE seo_rank_runs SET tasks=$2, checked=checked+$3, error=$4, lease_until=NULL WHERE id=$1",
          [run.id, JSON.stringify(remaining), written, errorNote]);
      }
    } catch (e) {
      await pool.query("UPDATE seo_rank_runs SET lease_until=NULL WHERE id=$1", [run.id]).catch(() => {});
      void recordFailure("job", "SEO rank run collect", e);
    }
  }
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
export async function snapshotBacklinks(site: SiteRow): Promise<{ id: number; takenOn: string; costUsd: number }> {
  const estimate = estimateBacklinkSnapshotUsd(BACKLINK_ROWS);
  const out = await withBudget(site.user_id, estimate, async () => {
    const summary = await seoJobDeps.backlinksSummary({ target: site.domain });
    let list: Awaited<ReturnType<typeof backlinksList>> | null = null;
    try { list = await seoJobDeps.backlinksList({ target: site.domain, limit: BACKLINK_ROWS }); }
    catch (e: any) { summary.costUsd += typeof e?.costUsd === "number" ? e.costUsd : 0; console.warn(`[seo] backlinks list failed for ${site.domain}: ${e?.message}`); }
    return { data: { summary: summary.data, backlinks: list?.data.items ?? [], totalCount: list?.data.totalCount ?? null }, costUsd: summary.costUsd + (list?.costUsd ?? 0) };
  });
  const { rows: [row] } = await pool.query(
    `INSERT INTO seo_backlink_snapshots(site_id,user_id,taken_on,summary,backlinks,cost_usd) VALUES($1,$2,current_date,$3,$4,$5)
     ON CONFLICT(site_id,taken_on) DO UPDATE SET summary=EXCLUDED.summary,backlinks=EXCLUDED.backlinks,cost_usd=seo_backlink_snapshots.cost_usd+EXCLUDED.cost_usd
     RETURNING id, taken_on`,
    [site.id, site.user_id, JSON.stringify({ ...out.data.summary, totalCount: out.data.totalCount }), JSON.stringify(out.data.backlinks), out.costUsd]);
  await pool.query("UPDATE seo_sites SET last_backlinks_at=now(), next_backlinks_at=now()+interval '1 month' WHERE id=$1", [site.id]);
  return { id: row.id, takenOn: String(row.taken_on).slice(0, 10), costUsd: out.costUsd };
}

async function runDueBacklinkSnapshots(): Promise<void> {
  if (!isConfigured()) return;
  const { rows: due } = await pool.query(
    `UPDATE seo_sites SET next_backlinks_at=now()+interval '1 month' WHERE next_backlinks_at<=now() AND last_backlinks_at IS NOT NULL RETURNING *`);
  for (const site of due) {
    try {
      const ent = await getEntitlements(site.user_id);
      if (!seoIncluded(ent)) continue;
      await snapshotBacklinks(site);
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
      await scheduleWeeklyRuns();
      for (let i = 0; i < 10 && (await postQueuedRun()); i++) { /* post up to 10 queued runs per tick */ }
      await collectRunningRuns();
      await runDueBacklinkSnapshots();
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
