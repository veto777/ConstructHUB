/**
 * Real-Postgres check that monthly AI answers already paid for are never lost or filed twice. Not part of the unit suite.
 * Run on a THROWAWAY database after script/seo-ledger-check.ts:
 *   DATABASE_URL=postgres://.../seotest npx tsx script/seo-ai-waiting-check.ts
 */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { saveAiAnswers } from "../server/seo/ai-visibility";
import { fileWaitingAiAnswers } from "../server/seo/ai-monthly";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const n = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0].n as number;

async function main() {
  await ensureSeoSchema();
  await ensureSeoSchema();
  const { rows: [site] } = await pool.query("INSERT INTO seo_sites(user_id,domain,devices) VALUES(1,'waiting.example','desktop') ON CONFLICT(user_id,domain) DO UPDATE SET devices=EXCLUDED.devices RETURNING id");
  await pool.query("DELETE FROM seo_ai_unsaved"); await pool.query("DELETE FROM seo_ai_checks WHERE site_id=$1", [site.id]);
  const answer = { engine: "chatgpt", model: "m", mentioned: true, cited: false, listedAt: 2, businesses: ["A", "B"], sources: [], searches: [], answer: "text" };
  const park = (run: string, siteId: number, when = "now() - interval '1 minute'") =>
    pool.query(`INSERT INTO seo_ai_unsaved(user_id, site_id, prompt, answers, cost_usd, run_id, next_at) VALUES(1,$1,'best roofer in tampa',$2,0.03,$3, ${when})`, [siteId, JSON.stringify([answer, { ...answer, engine: "gemini" }]), run]);

  await park("0000000a-0000-4000-8000-00000000000a", site.id);
  eq("1 a waiting run is filed, and leaves the waiting list in the same step", [await fileWaitingAiAnswers(), await n("SELECT count(*)::int n FROM seo_ai_checks WHERE run_id='0000000a-0000-4000-8000-00000000000a'"), await n("SELECT count(*)::int n FROM seo_ai_unsaved WHERE run_id='0000000a-0000-4000-8000-00000000000a'")], [1, 2, 0]);
  eq("1b what was filed reads back as it was", (await pool.query("SELECT engine, mentioned, listed_at, businesses FROM seo_ai_checks WHERE run_id='0000000a-0000-4000-8000-00000000000a' ORDER BY engine")).rows, [{ engine: "chatgpt", mentioned: true, listed_at: 2, businesses: ["A", "B"] }, { engine: "gemini", mentioned: true, listed_at: 2, businesses: ["A", "B"] }]);

  // Filed directly and also parked (the usual order in the job when the direct save works): never twice.
  await park("0000000b-0000-4000-8000-00000000000b", site.id);
  await saveAiAnswers(1, site.id, "best roofer in tampa", [answer as any], 0.03, "0000000b-0000-4000-8000-00000000000b");
  await saveAiAnswers(1, site.id, "best roofer in tampa", [answer as any], 0.03, "0000000b-0000-4000-8000-00000000000b");
  eq("2 filing the same run twice keeps one copy and clears the waiting list", [await n("SELECT count(*)::int n FROM seo_ai_checks WHERE run_id='0000000b-0000-4000-8000-00000000000b'"), await n("SELECT count(*)::int n FROM seo_ai_unsaved WHERE run_id='0000000b-0000-4000-8000-00000000000b'")], [1, 0]);

  // Not yet due: left alone.
  await park("0000000c-0000-4000-8000-00000000000c", site.id, "now() + interval '1 hour'");
  eq("3 a run not yet due is left for later", [await fileWaitingAiAnswers(), await n("SELECT count(*)::int n FROM seo_ai_unsaved WHERE run_id='0000000c-0000-4000-8000-00000000000c'")], [0, 1]);

  // A save that fails: the answers stay, and the next try is later.
  await park("0000000d-0000-4000-8000-00000000000d", site.id);
  await pool.query("ALTER TABLE seo_ai_checks ADD CONSTRAINT tmp_block CHECK (run_id <> '0000000d-0000-4000-8000-00000000000d')");
  const filed = await fileWaitingAiAnswers();
  const waiting = (await pool.query("SELECT tries, next_at > now() AS later, jsonb_array_length(answers) AS answers FROM seo_ai_unsaved WHERE run_id='0000000d-0000-4000-8000-00000000000d'")).rows[0];
  eq("4 a save that fails keeps the answers and waits before trying again", [filed, waiting, await n("SELECT count(*)::int n FROM seo_ai_checks WHERE run_id='0000000d-0000-4000-8000-00000000000d'")], [0, { tries: 1, later: true, answers: 2 }, 0]);
  await pool.query("ALTER TABLE seo_ai_checks DROP CONSTRAINT tmp_block");
  await pool.query("UPDATE seo_ai_unsaved SET next_at = now() - interval '1 minute' WHERE run_id='0000000d-0000-4000-8000-00000000000d'");
  eq("4b once the problem is gone the same answers are filed", [await fileWaitingAiAnswers(), await n("SELECT count(*)::int n FROM seo_ai_checks WHERE run_id='0000000d-0000-4000-8000-00000000000d'"), await n("SELECT count(*)::int n FROM seo_ai_unsaved WHERE run_id='0000000d-0000-4000-8000-00000000000d'")], [1, 2, 0]);

  // The site was removed meanwhile: nothing to file them under.
  await park("0000000e-0000-4000-8000-00000000000e", 999999);
  eq("5 answers for a site that no longer exists are dropped, not retried for ever", [await fileWaitingAiAnswers(), await n("SELECT count(*)::int n FROM seo_ai_unsaved WHERE run_id='0000000e-0000-4000-8000-00000000000e'")], [0, 0]);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
