/** Real-Postgres check of the dashboard's groups and positions (server/seo/dashboard.ts). THROWAWAY database. */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { dashboardRanks, groupNameSql } from "../server/seo/dashboard";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
(async () => {
  await ensureSeoSchema();
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
  await pool.query("DELETE FROM seo_sites WHERE domain LIKE '%.dash.example'");
  console.log(`dashboard checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
