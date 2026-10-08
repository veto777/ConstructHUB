/** Real-Postgres check of the dashboard's groups and positions (server/seo/dashboard.ts). THROWAWAY database. */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { dashboardRanks, groupNameSql } from "../server/seo/dashboard";
import { ensureSiteScanSchema } from "../server/sitescan/schema";
import { auditHealthByDomain, HEALTH_TREND } from "../server/seo/audit";
import { randomUUID } from "node:crypto";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
(async () => {
  await ensureSeoSchema(); await ensureSiteScanSchema();
  await pool.query("DELETE FROM seo_sites WHERE domain LIKE '%.dash.example'");
  const site = async (user: number, d: string, devices = "both") => (await pool.query("INSERT INTO seo_sites(user_id, domain, devices) VALUES($1,$2,$3) RETURNING id", [user, `${d}.dash.example`, devices])).rows[0].id as number;
  const a = await site(1, "a"), b = await site(1, "b", "mobile"), c = await site(2, "c");
  const setGroup = (id: number, g: string | null) => pool.query(`UPDATE seo_sites SET group_name=${groupNameSql("$2", "$3")} WHERE id=$1 RETURNING group_name`, [id, true, g]).then((r) => r.rows[0].group_name);
  ok((await setGroup(a, "Roofing")) === "Roofing", "a new group keeps its spelling");
  ok((await setGroup(b, "roofing")) === "Roofing", "the same name in another case joins that group");
  ok((await setGroup(c, "ROOFING")) === "ROOFING", "another account's groups are not looked at");
  ok((await setGroup(b, "")) === null, "an empty name takes the site out of its group");
  // Positions: site a tracks both devices — desktop counts, the better mobile result does not; b tracks mobile only.
  const kw = async (s: number, k: string) => (await pool.query("INSERT INTO seo_keywords(site_id, user_id, keyword) VALUES($1,1,$2) RETURNING id", [s, k])).rows[0].id as number;
  const chk = (k: number, s: number, device: string, pos: number | null, ago: number) => pool.query("INSERT INTO seo_rank_checks(keyword_id, site_id, device, position, checked_on) VALUES($1,$2,$3,$4, current_date - $5::int)", [k, s, device, pos, ago]);
  const k1 = await kw(a, "roof repair"), k2 = await kw(a, "gutters"), k3 = await kw(b, "siding");
  await chk(k1, a, "desktop", 14, 0); await chk(k1, a, "mobile", 2, 0);
  await chk(k2, a, "desktop", 5, 6); await chk(k2, a, "desktop", 30, 13);
  await chk(k3, b, "desktop", 1, 0); await chk(k3, b, "mobile", 8, 2);
  const r = await dashboardRanks([a, b]);
  const ra = r.get(a)!, rb = r.get(b)!;
  ok(ra.device === "desktop" && ra.top3 === 0 && ra.top10 === 1 && ra.checked === 2, `one device, never the better of two: ${JSON.stringify(ra)}`);
  ok(ra.firstOn! < ra.checkedOn!, "the dates the newest checks span are said");
  ok(rb.device === "mobile" && rb.top10 === 1 && rb.top3 === 0, `a mobile-only site counts mobile: ${JSON.stringify(rb)}`);
  // Site health over the newest crawls: 8 crawls of a.dash.example, health falling from 100 as pages break.
  await pool.query("DELETE FROM sitescan_jobs WHERE url LIKE 'https://a.dash.example%'");
  for (let i = 0; i < 8; i++) {
    const pages = Array.from({ length: 10 }, (_, k) => ({ url: `https://a.dash.example/p${k}`, status: k < i ? 404 : 200, redirects: [] }));
    await pool.query(`INSERT INTO sitescan_jobs(id, user_id, url, page_cap, state, status, report, completed_at) VALUES($1,$2,'https://a.dash.example/',$3,$4,'completed','{}'::jsonb, now() - $5::int * interval '1 day')`,
      [randomUUID(), 1, i === 0 ? 100 : 150, JSON.stringify({ pages }), 8 - i]);
  }
  await pool.query(`INSERT INTO sitescan_jobs(id, user_id, url, page_cap, state, status, report, completed_at) VALUES($1,2,'https://a.dash.example/',150,'{"pages":[]}','completed','{}'::jsonb, now())`, [randomUUID()]);
  const h = (await auditHealthByDomain(1, ["a.dash.example", "www.none.dash.example"])).get("a.dash.example")!;
  ok(h && h.trend.length === HEALTH_TREND, `the trend is the newest ${HEALTH_TREND} crawls: ${h?.trend.length}`);
  ok(h.trend.every((t, k) => k === 0 || t.at! > h.trend[k - 1].at!) && h.trend[h.trend.length - 1].jobId === h.jobId && h.health === h.trend[h.trend.length - 1].health, "oldest first, ending with the newest crawl");
  ok(h.trend[0].health! > h.health! && h.pages === 10 && h.errorPages === 7, `health falls as pages break; error pages are distinct pages: ${h.trend.map((t) => t.health)} / ${h.errorPages} of ${h.pages}`);
  ok(h.trend.every((t) => t.pageCap === 150), "each point carries its page limit (the older 100-page crawl is outside the newest six)");
  const { rows: [cached] } = await pool.query("SELECT count(*)::int AS n FROM seo_crawl_health WHERE job_id = ANY($1)", [h.trend.map((t) => t.jobId)]);
  ok(cached.n === HEALTH_TREND, "each crawl's health is worked out once and kept");
  // A crawl with no page to score between two scored ones: a gap, kept as such; the newest unreadable: said, never an older score.
  const ids = h.trend.map((t) => t.jobId);
  await pool.query("UPDATE sitescan_jobs SET state='{\"pages\":[]}' WHERE id::text=$1", [ids[ids.length - 2]]);
  const g = (await auditHealthByDomain(1, ["a.dash.example"])).get("a.dash.example")!;
  ok(g.trend[g.trend.length - 2].health === null && g.trend.length === HEALTH_TREND && g.health !== null, "a crawl with no score stays in the trend as a gap (worked out again: it changed)");
  // A page's status changed in the saved crawl (report untouched): worked out again.
  await pool.query(`UPDATE sitescan_jobs SET state=jsonb_set(state, '{pages,9,status}', '500') WHERE id::text=$1`, [g.jobId]);
  const s2 = (await auditHealthByDomain(1, ["a.dash.example"])).get("a.dash.example")!;
  ok(s2.errorPages === (g.errorPages ?? 0) + 1, `a changed page status is seen: ${g.errorPages} -> ${s2.errorPages}`);
  // The newest crawl's saved report broken: it stays the current crawl, "could not be read" — never an older score.
  await pool.query("UPDATE sitescan_jobs SET report='\"oops\"'::jsonb WHERE id::text=$1", [g.jobId]);
  const u = (await auditHealthByDomain(1, ["a.dash.example"])).get("a.dash.example")!;
  ok(u.jobId === g.jobId && u.readable === false && u.health === null, `a broken newest crawl is said, not replaced: ${JSON.stringify({ readable: u.readable, health: u.health })}`);
  await pool.query("DELETE FROM sitescan_jobs WHERE url LIKE 'https://a.dash.example%'");
  await pool.query("DELETE FROM seo_sites WHERE domain LIKE '%.dash.example'");
  console.log(`dashboard checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
