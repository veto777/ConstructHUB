/** Real-Postgres check of Site audit → compare with any earlier crawl (server/seo/audit.ts siteAudit `vs`). THROWAWAY database. */
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { ensureSiteScanSchema } from "../server/sitescan/schema";
import { siteAudit } from "../server/seo/audit";
import { buildSiteReport } from "../server/seo/site-report";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
const H = "https://compare.example";
(async () => {
  await ensureSeoSchema(); await ensureSiteScanSchema();
  await pool.query("DELETE FROM sitescan_jobs WHERE url LIKE 'https://compare.example%'");
  const report = (urls: string[]) => ({ findings: urls.length === 0 ? [] : [{ id: "missing-title", category: "content", severity: "critical", title: "Missing title", urls, why: "w", fix: "f" }] });
  const job = async (user: number, paths: string[], broken: string[], ago: number, cap = 150, url = `${H}/`) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO sitescan_jobs(id, user_id, url, page_cap, state, status, report, completed_at) VALUES($1,$2,$3,$4,$5,'completed',$6, now() - $7::int * interval '1 hour')`,
      [id, user, url, cap, JSON.stringify({ pages: paths.map((p) => ({ url: `${H}${p}`, status: 200, redirects: 0 })) }), JSON.stringify(report(broken.map((p) => `${H}${p}`))), ago]);
    return id;
  };
  const oldest = await job(1, ["/", "/a", "/gone"], ["/a", "/gone"], 72, 100);
  const middle = await job(1, ["/", "/a"], ["/a"], 48);
  const newest = await job(1, ["/", "/a", "/new"], [], 1);
  const other = await job(2, ["/"], [], 30);                                       // another account's crawl of the same site
  const otherSite = await job(1, ["/"], [], 30, 150, "https://elsewhere.example/"); // the same account's crawl of another site
  const def = await siteAudit(1, "compare.example");
  ok(def.audit?.jobId === newest && def.audit.comparedWith?.jobId === middle && def.audit.comparedWith.chosen === false, "by default the newest is compared with the crawl before it");
  ok(def.audit?.comparedWith?.addedPages === 1 && def.audit.comparedWith.removedPages === 0 && !def.audit.comparedWith.capsDiffer, "pages reached now and not then are counted");
  const vs = await siteAudit(1, "compare.example", { vs: oldest });
  ok(vs.audit?.comparedWith?.jobId === oldest && vs.audit.comparedWith.chosen && !vs.vsMissing, "a chosen earlier crawl is compared with");
  ok(JSON.stringify(vs.audit?.comparedWith?.removed) === JSON.stringify([`${H}/gone`]) && vs.audit?.comparedWith?.capsDiffer === true, "the chosen crawl's missing pages and its different page limit are said");
  ok(def.audit?.fixed.some((f) => f.key === "missing-title" && f.previous === 1), `against the crawl before, the issue is fixed (1 page): ${JSON.stringify(def.audit?.fixed)}`);
  // Against the oldest, one of its pages (/gone) was not crawled again: not re-checked, never "fixed" — measured against the chosen crawl.
  ok(!vs.audit?.fixed.length && vs.audit?.notRechecked.some((f) => f.key === "missing-title" && f.previous === 2), `against the chosen crawl: ${JSON.stringify(vs.audit?.notRechecked)}`);
  for (const [bad, why] of [[other, "another account's crawl"], [otherSite, "another site's crawl"], [newest, "the newest itself"], [randomUUID(), "an unknown id"]] as const) {
    const r = await siteAudit(1, "compare.example", { vs: bad });
    ok(r.audit?.comparedWith?.jobId === middle && r.vsMissing === true, `${why} is refused, said, and the crawl before is used`);
  }
  // Any two crawls: an older crawl shown, compared with the one before it or a chosen one older still.
  const shown = await siteAudit(1, "compare.example", { at: middle });
  ok(shown.audit?.jobId === middle && shown.audit.latest === false && shown.audit.comparedWith?.jobId === oldest && !shown.audit.comparedWith.chosen && shown.latestId === newest, "an older crawl can be shown, against the crawl before it; the newest is still named");
  const newer = await siteAudit(1, "compare.example", { at: middle, vs: newest });
  ok(newer.vsMissing === true && newer.audit?.comparedWith?.jobId === oldest, "a crawl newer than the one shown is not a baseline (said)");
  const foreign = await siteAudit(1, "compare.example", { at: other });
  ok(foreign.atMissing === true && foreign.audit?.jobId === newest, "another account's crawl cannot be shown (said; the newest is shown)");
  const none = await siteAudit(1, "nocrawl.example", { at: randomUUID(), vs: randomUUID() });
  ok(none.audit === null && none.atMissing === true && none.vsMissing === true, "with no crawl at all, crawls asked for are still said to be unavailable");
  ok(def.crawls.map((c) => c.jobId).join() === [newest, middle, oldest].join() && def.crawls[2].pageCap === 100, "the pickers list this account's crawls of this site, newest first, with their page limits");
  // A newer crawl saved in a form the crawler never writes (a severity it never uses): said, and nothing older shown in its place.
  const broken = await job(1, ["/"], [], 0);
  await pool.query(`UPDATE sitescan_jobs SET report='{"findings":[{"id":"x","category":"content","severity":"error","title":"X","urls":["https://compare.example/"]}]}'::jsonb WHERE id=$1`, [broken]);
  const ub = await siteAudit(1, "compare.example");
  ok(ub.newestUnreadable?.jobId === broken && ub.audit === null && ub.crawls[0].jobId === broken && ub.crawls[0].readable === false && ub.crawls[1].jobId === newest && ub.crawls[1].readable, "a broken newest crawl is said; no older score takes its place; it is listed as unreadable and the readable ones can be picked");
  // Shown: the crawl after a broken one has no default change (never a jump to an older one called "the crawl before").
  const after = await job(1, ["/", "/a"], [], 0);
  await pool.query("UPDATE sitescan_jobs SET completed_at = now() + interval '1 minute' WHERE id=$1", [after]);
  const gap = await siteAudit(1, "compare.example");
  ok(gap.audit?.jobId === after && gap.audit.comparedWith === null && gap.previousUnreadable?.jobId === broken && gap.history.some((h) => h.jobId === broken && h.unreadable), "a broken crawl in between: no default change, said, and a gap in the history");
  await pool.query("DELETE FROM sitescan_jobs WHERE id=$1", [after]);
  const picked = await siteAudit(1, "compare.example", { at: newest });
  ok(picked.audit?.jobId === newest && picked.audit.latest === false, "an earlier crawl picked is shown as not the newest");
  const { rows: [s1] } = await pool.query("INSERT INTO seo_sites(user_id, domain) VALUES(1,'compare.example') RETURNING id");
  const rep = await buildSiteReport(1, s1.id);
  ok(rep?.audit === null && typeof rep?.auditUnreadable === "string", "the client report says the newest crawl could not be read, with no older score");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [s1.id]);
  await pool.query("DELETE FROM sitescan_jobs WHERE url LIKE 'https://compare.example%' OR url LIKE 'https://elsewhere.example%'");
  // A Google-profile gap ("no page for Gutters") is fixed only on positive evidence read from the stored crawl: the same
  // profile still lists it AND a page of THIS crawl names it in its title or an H1 (the crawler's own rule). An empty
  // crawl, or pages saved without titles, is "not re-checked" — never a fix (audit #55).
  const G = "https://gapsite.example";
  const gapJob = async (pages: unknown[], findings: unknown[], ago: number) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO sitescan_jobs(id, user_id, url, page_cap, state, status, report, completed_at) VALUES($1,1,$2,150,$3,'completed',$4, now() - $5::int * interval '1 minute')`,
      [id, `${G}/`, JSON.stringify({ pages }), JSON.stringify({ profile: { id: 5, services: ["Gutters"], service_areas: [] }, findings }), ago]);
    return id;
  };
  const gapFinding = { id: "gap-services-Gutters", category: "local", severity: "warning", title: "No matching service page: Gutters", urls: [`${G}/`], why: "w", fix: "f" };
  const withGap = await gapJob([{ url: `${G}/`, status: 200, redirects: [], title: "Home", h1: ["Welcome"] }], [gapFinding], 60);
  const named = await gapJob([{ url: `${G}/`, status: 200, redirects: [], title: "Home", h1: ["Welcome"] }, { url: `${G}/gutters`, status: 200, redirects: [], title: "Services", h1: ["Seamless GUTTERS"] }], [], 30);
  const byH1 = await siteAudit(1, "gapsite.example");
  ok(byH1.audit?.jobId === named && byH1.audit.fixed.map((f) => f.key).join() === "gap-services" && !byH1.audit.notRechecked.length, `a page naming the service in an H1, read from the stored crawl: fixed (${JSON.stringify(byH1.audit?.fixed)})`);
  const empty = await gapJob([], [], 20);
  const nothing = await siteAudit(1, "gapsite.example", { vs: withGap });
  ok(nothing.audit?.jobId === empty && nothing.audit.comparedWith?.jobId === withGap && !nothing.audit.fixed.length && nothing.audit.notRechecked.map((f) => f.key).join() === "gap-services", `an empty crawl with the same profile (no gap raised): not re-checked, never fixed (${JSON.stringify(nothing.audit?.notRechecked)})`);
  await pool.query("DELETE FROM sitescan_jobs WHERE id=$1", [empty]);
  const untitled = await gapJob([{ url: `${G}/gutters`, status: 200, redirects: [], title: 7, h1: "Gutters" }], [], 10);
  const malformed = await siteAudit(1, "gapsite.example", { vs: withGap });
  ok(malformed.audit?.jobId === untitled && malformed.audit.comparedWith?.jobId === withGap && !malformed.audit.fixed.length && malformed.audit.notRechecked.map((f) => f.key).join() === "gap-services", "pages saved with a title and H1s in the wrong form have nothing to match: not re-checked");
  await pool.query("DELETE FROM sitescan_jobs WHERE url LIKE 'https://gapsite.example%'");
  console.log(`audit compare checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
