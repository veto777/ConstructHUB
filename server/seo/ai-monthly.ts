/**
 * The monthly re-asking of AI questions a customer chose to track (server/seo/jobs.ts runs it every minute; a
 * question is due once every 30 days). It spends the month's included SEO data only — never credit the customer
 * bought — and nothing at all once the account no longer has the SEO tools.
 */
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { getEntitlements } from "../entitlements";
import { seoIncluded } from "./plan";
import { withBudget, SeoBudgetError } from "./budget";
import { isConfigured } from "./dataforseo";
import { AI_ENGINES, AI_ENGINE_KEYS, askAi, askEstimateUsd, saveAiAnswers, type AiEngine } from "./ai-visibility";

/**
 * File answers that were paid for earlier but could not be saved then. Nothing is bought here. A row is tried
 * again later and later (at most every six hours) and is removed only when its answers are filed, or its site is gone.
 */
export async function fileWaitingAiAnswers(): Promise<number> {
  const { rows } = await pool.query(
    `UPDATE seo_ai_unsaved SET tries = tries + 1, next_at = now() + least(tries + 1, 36) * interval '10 minutes'
      WHERE id IN (SELECT id FROM seo_ai_unsaved WHERE state='paid' AND next_at <= now() ORDER BY id LIMIT 5 FOR UPDATE SKIP LOCKED)
     RETURNING id, user_id, site_id, prompt, answers, cost_usd, run_id, tries`);
  let filed = 0;
  for (const w of rows) {
    try {
      const { rows: [site] } = await pool.query("SELECT 1 FROM seo_sites WHERE id=$1 AND user_id=$2", [w.site_id, w.user_id]);
      if (!site) { await pool.query("DELETE FROM seo_ai_unsaved WHERE id=$1", [w.id]); continue; }
      await saveAiAnswers(w.user_id, w.site_id, w.prompt, w.answers, Number(w.cost_usd), w.run_id);
      filed++;
    } catch (e: any) { console.error(`[seo] AI answers waiting to be filed (run ${w.run_id}, try ${w.tries}) still could not be saved: ${e?.message ?? e}`); }
  }
  return filed;
}

type Tracked = { id: number; user_id: number; site_id: number; prompt: string };
/**
 * Open the run BEFORE anything is bought. If the process dies between here and the answers being parked, this row is
 * what says "an ask for this question was started and its outcome is unknown" — and such a question is not asked
 * again on its own (see the top of the loop in runDueAiChecks).
 */
async function openRun(t: Tracked, runId: string): Promise<void> {
  await pool.query("INSERT INTO seo_ai_unsaved(user_id, site_id, prompt, answers, run_id, state, tracked_id, next_at) VALUES($1,$2,$3,NULL,$4,'opened',$5, now())", [t.user_id, t.site_id, t.prompt, runId, t.id]);
}
/** The last thing before the ask leaves: from here on the outcome is unknown until answers are parked. If this cannot be written, nothing is sent. */
async function markDispatching(runId: string): Promise<void> {
  const { rowCount } = await pool.query("UPDATE seo_ai_unsaved SET state='asking' WHERE run_id=$1 AND state='opened'", [runId]);
  if (!rowCount) throw new Error(`AI run ${runId} is no longer open`);
}
/** The ask certainly bought nothing (refused before it was sent, or the source said no): the run is closed, and the question may be asked again when its lease runs out. */
const closeRun = (runId: string) => pool.query("DELETE FROM seo_ai_unsaved WHERE run_id=$1 AND state IN ('opened','asking')", [runId]);
/** An error after which we cannot say whether the source did the work (and billed it). Such a run is NOT closed. */
const outcomeUnknown = (e: any) => e?.costUnknown === true || e?.code === "timeout" || e?.code === "upstream" || e?.parked === false;
// (A connection that failed before the request left looks the same as one that failed after: it is treated as unknown.)
/** After a paid ask, in one step: the month moves on and the answers go on the waiting list. */
async function parkPaidAnswers(t: Tracked, answers: unknown, costUsd: number, runId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE seo_ai_tracked SET next_at = now() + interval '30 days' WHERE id=$1", [t.id]);
    const { rowCount } = await client.query("UPDATE seo_ai_unsaved SET answers=$2, cost_usd=$3, state='paid', next_at = now() + interval '5 minutes' WHERE run_id=$1", [runId, JSON.stringify(answers), costUsd]);
    if (!rowCount) await client.query("INSERT INTO seo_ai_unsaved(user_id, site_id, prompt, answers, cost_usd, run_id, state, tracked_id, next_at) VALUES($1,$2,$3,$4,$5,$6,'paid',$7, now() + interval '5 minutes') ON CONFLICT (run_id) DO NOTHING",
      [t.user_id, t.site_id, t.prompt, JSON.stringify(answers), costUsd, runId, t.id]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

export async function runDueAiChecks(): Promise<number> {
  await fileWaitingAiAnswers().catch((e) => console.error("[seo] filing waiting AI answers failed", e?.message ?? e));
  if (!isConfigured()) return 0;
  // Leased for an hour first: a failed call leaves the question due again when the lease runs out.
  const { rows: due } = await pool.query(
    `UPDATE seo_ai_tracked SET next_at = now() + interval '1 hour'
      WHERE id IN (SELECT id FROM seo_ai_tracked WHERE next_at <= now() ORDER BY next_at LIMIT 3 FOR UPDATE SKIP LOCKED)
     RETURNING id, site_id, user_id, prompt, engines`);
  const later = (id: number, interval: string) => pool.query(`UPDATE seo_ai_tracked SET next_at = now() + interval '${interval}' WHERE id=$1`, [id]).catch(() => {});
  let done = 0;
  for (const t of due) {
    try {
      // An earlier ask for this question was started and its outcome is unknown (the process stopped mid-ask, the source
      // timed out, or the answers could not be put away): it may have been paid for. It is not bought again on our own —
      // in ONE statement the unfinished run is cleared and the month moves on, and the loss is recorded for a person to see.
      // A run that was opened but never sent (the process stopped before the ask left, or the budget refused it and the
      // row could not be cleared) bought nothing: it is cleared and the question is simply asked now.
      await pool.query("DELETE FROM seo_ai_unsaved WHERE tracked_id=$1 AND state='opened'", [t.id]);
      const { rows: unsure } = await pool.query(
        `WITH gone AS (DELETE FROM seo_ai_unsaved WHERE tracked_id=$1 AND state='asking' RETURNING run_id, created_at),
              moved AS (UPDATE seo_ai_tracked SET next_at = now() + interval '30 days' WHERE id=$1 AND EXISTS (SELECT 1 FROM gone) RETURNING id)
         SELECT gone.run_id, gone.created_at, (SELECT count(*) FROM moved) AS moved FROM gone`, [t.id]);
      if (unsure.length) {
        console.error(`[seo] monthly AI question ${t.id} (site ${t.site_id}): an ask started ${new Date(unsure[0].created_at).toISOString()} never finished (run ${unsure[0].run_id}); not asking again this month`);
        continue;
      }
      // No SEO tools on the account, or the site is gone: look again tomorrow, spend nothing.
      if (!seoIncluded(await getEntitlements(t.user_id))) { await later(t.id, "1 day"); continue; }
      const { rows: [site] } = await pool.query("SELECT domain, business_name FROM seo_sites WHERE id=$1 AND user_id=$2", [t.site_id, t.user_id]);
      const engines = (t.engines as string[]).filter((e): e is AiEngine => (AI_ENGINE_KEYS as string[]).includes(e));
      if (!site || !engines.length) { await later(t.id, "1 day"); continue; }
      const runId = randomUUID();
      await openRun(t, runId); // if this cannot be written, nothing is bought
      let out;
      try {
        out = await withBudget(t.user_id, askEstimateUsd(engines), async () => {
          // The money is reserved (withBudget did that before calling us); only now is the run marked as on its way.
          await markDispatching(runId);
          const r = await askAi(t.prompt, engines, { domain: site.domain, businessName: site.business_name });
          // Put away BEFORE it is charged: the month moves on and the answers go on the waiting list in one step. If that
          // cannot be done, this throws — the customer pays nothing for answers we could not keep, and the run stays
          // "unfinished" so the question is not bought again.
          let parked = false, lastError: unknown = null;
          for (let attempt = 1; attempt <= 3 && !parked; attempt++) {
            try { await parkPaidAnswers(t, r.data.answers, r.costUsd, runId); parked = true; }
            catch (e) { lastError = e; await new Promise((res) => setTimeout(res, 500 * attempt)); }
          }
          if (!parked) throw Object.assign(new Error(`answers could not be put on the waiting list: ${(lastError as any)?.message ?? lastError}`), { costUsd: r.costUsd, costUnknown: r.costUnknown, parked: false });
          return r;
        }, { allowanceOnly: true, label: `AI visibility — "${String(t.prompt).slice(0, 90)}" (${engines.map((e) => AI_ENGINES[e].label).join(", ")}, monthly #${t.id}) for ${site.domain}` }); // the usage page opens the question by its id and site
      } catch (e) {
        // Only a failure that certainly bought nothing closes the run; anything ambiguous leaves it for the branch above.
        if (!outcomeUnknown(e)) await closeRun(runId).catch(() => {});
        throw e;
      }
      // Charged, and the answers are safely parked. Filing them takes them off the waiting list; if it fails they
      // stay there and fileWaitingAiAnswers keeps trying.
      await saveAiAnswers(t.user_id, t.site_id, t.prompt, out.data.answers, out.costUsd, runId)
        .catch((e: any) => console.error(`[seo] monthly AI answers for site ${t.site_id} are paid for and waiting to be filed: ${e?.message ?? e}`));
      done++;
    } catch (e: any) {
      // Out of included data: nothing more this month is likely, so look again tomorrow rather than every hour.
      if (e instanceof SeoBudgetError) { console.warn(`[seo] monthly AI question for site ${t.site_id} skipped: ${e.message}`); await later(t.id, "1 day"); }
      else console.error(`[seo] monthly AI question for site ${t.site_id} failed${outcomeUnknown(e) ? " with an unknown outcome (it will not be bought again this month)" : " (it will be tried again in an hour)"}: ${e?.message ?? e}`);
    }
  }
  return done;
}
