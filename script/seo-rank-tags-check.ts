/** Real-Postgres check of Rank tracker -> by tag (server/seo/rank-tags.ts): the two newest checks, one device. THROWAWAY database. */
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { rankTags } from "../server/seo/rank-tags";
import { buildSiteReport } from "../server/seo/site-report";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
(async () => {
  await ensureSeoSchema();
  await pool.query("DELETE FROM seo_sites WHERE domain='tags.example'");
  const { rows: [site] } = await pool.query("INSERT INTO seo_sites(user_id, domain, devices) VALUES(1,'tags.example','both') RETURNING id, devices");
  const kw = async (k: string, tags: string[]) => (await pool.query("INSERT INTO seo_keywords(site_id, user_id, keyword, tags, search_volume) VALUES($1,1,$2,$3,100) RETURNING id", [site.id, k, tags])).rows[0].id as number;
  const a = await kw("roof repair", ["roofing"]), b = await kw("roof replacement", ["roofing"]), c = await kw("siding", ["siding"]);
  const run = async (ago: number) => { const id = randomUUID(); await pool.query("INSERT INTO seo_rank_runs(id, site_id, user_id, status) VALUES($1,$2,1,'done')", [id, site.id]); return { id, ago }; };
  const chk = (r: { id: string | null; ago: number }, k: number, device: string, pos: number | null) => pool.query("INSERT INTO seo_rank_checks(keyword_id, site_id, run_id, device, position, checked_on) VALUES($1,$2,$3,$4,$5, current_date - $6::int)", [k, site.id, r.id, device, pos, r.ago]);
  // A check from before runs were recorded (a day), then two runs; mobile only in the oldest.
  const legacy = { id: null, ago: 21 };
  await chk(legacy, a, "desktop", 40); await chk(legacy, a, "mobile", 1);
  const r1 = await run(14); await chk(r1, a, "desktop", 12); await chk(r1, c, "desktop", 3);
  const r2 = await run(7); await chk(r2, a, "desktop", 4); await chk(r2, b, "desktop", 9); await chk(r2, c, "desktop", null);
  const t = await rankTags(site);
  const roofing = t.rows.find((r) => r.tag === "roofing")!, siding = t.rows.find((r) => r.tag === "siding")!;
  ok(t.device === "desktop" && t.devices.join() === "desktop,mobile", "desktop first when the site tracks both");
  ok(t.now?.keywords === 3 && t.before?.keywords === 2 && t.now.to > t.before.to, `each keyword's newest check against its own one before: ${JSON.stringify([t.now, t.before])}`);
  // A partial run (one keyword) afterwards: the others keep their newest check; the span says so.
  const r3 = await run(1); await chk(r3, c, "desktop", 6);
  const p3 = await rankTags(site);
  ok(p3.now?.from !== p3.now?.to && p3.rows.find((r) => r.tag === "roofing")!.checked === 2 && p3.rows.find((r) => r.tag === "siding")!.top10Change === 1, `a partial run does not empty the other tags: ${JSON.stringify(p3.now)}`);
  await pool.query("DELETE FROM seo_rank_checks WHERE run_id=$1", [r3.id]);
  ok(roofing.checked === 2 && roofing.compared === 1 && roofing.newSince === 1 && roofing.top10Change === 1 && roofing.positionBefore === 12 && roofing.positionNow === 4, `roofing: one compared (12 -> 4), one new since: ${JSON.stringify(roofing)}`);
  ok(siding.top10Change === -1 && siding.ranked === 0, "siding dropped out of the top 10");
  const m = await rankTags(site, "mobile");
  ok(m.device === "mobile" && m.now?.keywords === 1 && m.before === null && m.rows.find((r) => r.tag === "roofing")!.visibilityChange === null, "mobile: one old check, so no changes are claimed");
  const rep = await buildSiteReport(1, site.id);
  const bt = rep?.rankings?.byTag ?? [];
  ok(bt.map((t) => t.tag).join() === "roofing,siding" && bt[0].keywords === 2, `the client report carries the tags: ${JSON.stringify(bt)}`);
  ok((await buildSiteReport(2, site.id)) === null, "another account gets no report of the site");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [site.id]);
  console.log(`rank tags checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
