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
      WHERE id IN (SELECT id FROM seo_ai_unsaved WHERE next_at <= now() ORDER BY id LIMIT 5 FOR UPDATE SKIP LOCKED)
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

/** After a paid ask, in one step: the month moves on and the answers go on the waiting list. */
async function parkPaidAnswers(t: { id: number; user_id: number; site_id: number; prompt: string }, answers: unknown, costUsd: number, runId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE seo_ai_tracked SET next_at = now() + interval '30 days' WHERE id=$1", [t.id]);
    await client.query("INSERT INTO seo_ai_unsaved(user_id, site_id, prompt, answers, cost_usd, run_id, next_at) VALUES($1,$2,$3,$4,$5,$6, now() + interval '5 minutes') ON CONFLICT (run_id) DO NOTHING",
      [t.user_id, t.site_id, t.prompt, JSON.stringify(answers), costUsd, runId]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

export async function runDueAiChecks(): Promise<number> {
  await fileWaitingAiAnswers().catch((e) => console.error("[seo] filing waiting AI answers failed", e?.message ?? e));
  if (!isConfigured()) return 0;
  // Leased for an hour first: a crash or a failed call leaves the question due again when the lease runs out. Once an
  // ask is paid for, the month moves on together with putting its answers on the waiting list (parkPaidAnswers).
  const { rows: due } = await pool.query(
    `UPDATE seo_ai_tracked SET next_at = now() + interval '1 hour'
      WHERE id IN (SELECT id FROM seo_ai_tracked WHERE next_at <= now() ORDER BY next_at LIMIT 3 FOR UPDATE SKIP LOCKED)
     RETURNING id, site_id, user_id, prompt, engines`);
  const later = (id: number, interval: string) => pool.query(`UPDATE seo_ai_tracked SET next_at = now() + interval '${interval}' WHERE id=$1`, [id]).catch(() => {});
  let done = 0;
  for (const t of due) {
    try {
      // No SEO tools on the account, or the site is gone: look again tomorrow, spend nothing.
      if (!seoIncluded(await getEntitlements(t.user_id))) { await later(t.id, "1 day"); continue; }
      const { rows: [site] } = await pool.query("SELECT domain, business_name FROM seo_sites WHERE id=$1 AND user_id=$2", [t.site_id, t.user_id]);
      const engines = (t.engines as string[]).filter((e): e is AiEngine => (AI_ENGINE_KEYS as string[]).includes(e));
      if (!site || !engines.length) { await later(t.id, "1 day"); continue; }
      const out = await withBudget(t.user_id, askEstimateUsd(engines), () => askAi(t.prompt, engines, { domain: site.domain, businessName: site.business_name }),
        { allowanceOnly: true, label: `AI visibility — "${String(t.prompt).slice(0, 90)}" (${engines.map((e) => AI_ENGINES[e].label).join(", ")}, monthly)` });
      // Paid. In one step the month moves on and the answers go on the waiting list, so from here on a saving
      // problem can neither buy the same answers again nor lose them: fileWaitingAiAnswers keeps trying.
      const runId = randomUUID();
      let parked = false;
      for (let attempt = 1; attempt <= 3 && !parked; attempt++) {
        try { await parkPaidAnswers(t, out.data.answers, out.costUsd, runId); parked = true; }
        catch (e: any) { if (attempt === 3) console.error(`[seo] monthly AI answers for site ${t.site_id} could not be put on the waiting list: ${e?.message ?? e}`); else await new Promise((r) => setTimeout(r, 500 * attempt)); }
      }
      try {
        await saveAiAnswers(t.user_id, t.site_id, t.prompt, out.data.answers, out.costUsd, runId);
        // Filed without having been parked (the database refused the first step): the month still has to move on.
        if (!parked) await pool.query("UPDATE seo_ai_tracked SET next_at = now() + interval '30 days' WHERE id=$1", [t.id]);
      } catch (e: any) {
        console.error(`[seo] monthly AI answers for site ${t.site_id} were paid for and ${parked ? "are waiting to be filed" : "COULD NOT BE KEPT (database unavailable)"}: ${e?.message ?? e}`);
      }
      done++;
    } catch (e: any) {
      // Out of included data: nothing more this month is likely, so look again tomorrow rather than every hour.
      if (e instanceof SeoBudgetError) { console.warn(`[seo] monthly AI question for site ${t.site_id} skipped: ${e.message}`); await later(t.id, "1 day"); }
      else console.error(`[seo] monthly AI question for site ${t.site_id} failed (it will be tried again in an hour): ${e?.message ?? e}`);
    }
  }
  return done;
}
