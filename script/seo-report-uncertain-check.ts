/** Real-Postgres check: a report email whose earlier send died after the email log claimed it is never sent again (server/seo/site-report-send.ts). THROWAWAY database; mail goes to the dev sink. */
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { ensureSiteScanSchema } from "../server/sitescan/schema";
import { sendSiteReport } from "../server/seo/site-report-send";
import { getSchedule } from "../server/seo/site-report";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
(async () => {
  process.env.EMAIL_FORCE_SINK = "1";
  await ensureSeoSchema(); await ensureSiteScanSchema();
  await pool.query("CREATE TABLE IF NOT EXISTS email_log (id bigserial PRIMARY KEY, user_id integer, kind text, dedupe_key text UNIQUE, sent_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS seo_report_optouts (user_id integer, email text, PRIMARY KEY (user_id, email))").catch(() => {});
  const { rows: [site] } = await pool.query("INSERT INTO seo_sites(user_id, domain) VALUES(1,'unsure.example') RETURNING id");
  await pool.query(`INSERT INTO sitescan_jobs(id, user_id, url, page_cap, state, status, report, completed_at) VALUES($1,1,'https://unsure.example/',150,$2,'completed',$3, now())`,
    [randomUUID(), JSON.stringify({ pages: [{ url: "https://unsure.example/", status: 200, redirects: [] }] }), JSON.stringify({ findings: [{ id: "missing-title", category: "content", severity: "critical", title: "Missing title", urls: ["https://unsure.example/"] }] })]);
  const period = "2026-10", key = (to: string) => `seo-report:${site.id}:${period}:${to}`;
  // a@: a send that died after claiming the email log (both an hour old). b@: a send under way (claimed a minute ago).
  await pool.query("INSERT INTO email_log(user_id, kind, dedupe_key, sent_at) VALUES(1,'seo.report',$1, now() - interval '1 hour'), (1,'seo.report',$2, now() - interval '1 minute')", [key("a@example.com"), key("b@example.com")]);
  await pool.query("INSERT INTO seo_report_deliveries(site_id, period, recipient, state, token, updated_at) VALUES($1,$2,'a@example.com','pending','dead', now() - interval '1 hour')", [site.id, period]);
  const r = await sendSiteReport(1, site.id, ["a@example.com", "b@example.com", "c@example.com"], period);
  ok(!r.empty, `the report has something to send: ${JSON.stringify(r)}`);
  ok(r.sent === 1 && r.failed === 1 && JSON.stringify(r.uncertain) === JSON.stringify(["a@example.com"]), `c@ is sent, b@ (under way) is left for later, a@ is not sent again: ${JSON.stringify(r)}`);
  const { rows: log } = await pool.query("SELECT dedupe_key, sent_at < now() - interval '30 minutes' AS old FROM email_log WHERE dedupe_key=$1", [key("a@example.com")]);
  ok(log.length === 1 && log[0].old, "the old email-log claim is kept, not deleted and re-sent");
  const { rows: st } = await pool.query("SELECT recipient, state FROM seo_report_deliveries WHERE site_id=$1 ORDER BY recipient", [site.id]);
  ok(JSON.stringify(st.map((x: any) => `${x.recipient}:${x.state}`)) === JSON.stringify(["a@example.com:uncertain", "c@example.com:sent"]), `delivery states: ${JSON.stringify(st)}`);
  const again = await sendSiteReport(1, site.id, ["a@example.com"], period);
  ok(again.sent === 0 && again.failed === 0 && again.uncertain.length === 1, "a retry of the occurrence does not send it either, and can finish");
  const sch = await getSchedule(1, site.id), other = await getSchedule(2, site.id);
  ok(sch.uncertain?.length === 1 && sch.uncertain[0].recipient === "a@example.com" && sch.uncertain[0].period === "the October 2026 report" && other.uncertain?.length === 0, `the Reports page is told which report, and only the site's own account: ${JSON.stringify(sch.uncertain)}`);
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [site.id]);
  console.log(`report uncertain checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
