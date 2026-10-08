/** Real-Postgres check of a scheduled report's occurrence (server/seo/site-report-send.ts): fixed at its first lease and kept for retries. THROWAWAY database. */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { sendDueReports } from "../server/seo/site-report-send";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
(async () => {
  await ensureSeoSchema();
  const { rows: [site] } = await pool.query("INSERT INTO seo_sites(user_id, domain) VALUES(1,'sched.example') RETURNING id");
  await pool.query("INSERT INTO seo_report_schedules(site_id, user_id, frequency, recipients, next_send_at, last_sent_at) VALUES($1,1,'monthly',ARRAY['a@example.com'], now() - interval '1 minute', now() - interval '20 days')", [site.id]);
  const read = () => pool.query("SELECT work_since, work_cutoff, work_period, last_sent_at, next_send_at > now() AS leased FROM seo_report_schedules WHERE site_id=$1", [site.id]).then((r) => r.rows[0]);
  await sendDueReports().catch(() => 0);
  const a = await read();
  ok(a.leased && a.work_cutoff && new Date(a.work_since).getTime() === new Date(a.last_sent_at).getTime() && /^\d{4}-\d{2}$/.test(a.work_period), `first lease fixes the occurrence: from the last send, to now, period ${a.work_period}`);
  // Due again (a retry): the same occurrence, not a new one.
  await pool.query("UPDATE seo_report_schedules SET next_send_at = now() - interval '1 minute' WHERE site_id=$1", [site.id]);
  await sendDueReports().catch(() => 0);
  const b = await read();
  ok(new Date(b.work_cutoff).getTime() === new Date(a.work_cutoff).getTime() && new Date(b.work_since).getTime() === new Date(a.work_since).getTime() && b.work_period === a.work_period, "a retry keeps the same occurrence");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [site.id]);
  console.log(`report schedule checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
