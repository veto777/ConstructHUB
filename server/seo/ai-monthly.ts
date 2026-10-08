/**
 * The monthly re-asking of AI questions a customer chose to track (server/seo/jobs.ts runs it every minute; a
 * question is due once every 30 days). It spends the month's included SEO data only — never credit the customer
 * bought — and nothing at all once the account no longer has the SEO tools.
 */
import { pool } from "../db";
import { getEntitlements } from "../entitlements";
import { seoIncluded } from "./plan";
import { withBudget, SeoBudgetError } from "./budget";
import { isConfigured } from "./dataforseo";
import { AI_ENGINES, AI_ENGINE_KEYS, askAi, askEstimateUsd, saveAiAnswers, type AiEngine } from "./ai-visibility";

export async function runDueAiChecks(): Promise<number> {
  if (!isConfigured()) return 0;
  // Claimed by moving the date on: a crash means the question is simply asked next month, never twice.
  const { rows: due } = await pool.query(
    `UPDATE seo_ai_tracked SET next_at = now() + interval '30 days'
      WHERE id IN (SELECT id FROM seo_ai_tracked WHERE next_at <= now() ORDER BY next_at LIMIT 3 FOR UPDATE SKIP LOCKED)
     RETURNING id, site_id, user_id, prompt, engines`);
  let done = 0;
  for (const t of due) {
    try {
      if (!seoIncluded(await getEntitlements(t.user_id))) continue;
      const { rows: [site] } = await pool.query("SELECT domain, business_name FROM seo_sites WHERE id=$1 AND user_id=$2", [t.site_id, t.user_id]);
      if (!site) continue;
      const engines = (t.engines as string[]).filter((e): e is AiEngine => (AI_ENGINE_KEYS as string[]).includes(e));
      if (!engines.length) continue;
      const out = await withBudget(t.user_id, askEstimateUsd(engines), () => askAi(t.prompt, engines, { domain: site.domain, businessName: site.business_name }),
        { allowanceOnly: true, label: `AI visibility — "${String(t.prompt).slice(0, 90)}" (${engines.map((e) => AI_ENGINES[e].label).join(", ")}, monthly)` });
      await saveAiAnswers(t.user_id, t.site_id, t.prompt, out.data.answers, out.costUsd);
      done++;
    } catch (e: any) {
      if (e instanceof SeoBudgetError) console.warn(`[seo] monthly AI question for site ${t.site_id} skipped: ${e.message}`);
      else console.error(`[seo] monthly AI question for site ${t.site_id} failed: ${e?.message ?? e}`);
    }
  }
  return done;
}
