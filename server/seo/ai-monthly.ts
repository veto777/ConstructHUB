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

export async function runDueAiChecks(): Promise<number> {
  if (!isConfigured()) return 0;
  // Leased for an hour first: a crash or a failed call leaves the question due again when the lease runs out; the month
  // moves on only once the answers are saved. (An ask that fails after saving nothing is simply asked again.)
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
      // Paid: the month moves on now, before anything else can fail — a saving problem must never buy the same answers again.
      await pool.query("UPDATE seo_ai_tracked SET next_at = now() + interval '30 days' WHERE id=$1", [t.id]);
      const runId = randomUUID();
      for (let attempt = 1; ; attempt++) {
        try { await saveAiAnswers(t.user_id, t.site_id, t.prompt, out.data.answers, out.costUsd, runId); break; }
        catch (e: any) { if (attempt >= 3) { console.error(`[seo] monthly AI answers for site ${t.site_id} were paid for but could not be saved: ${e?.message ?? e}`); break; } await new Promise((r) => setTimeout(r, 500 * attempt)); }
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
