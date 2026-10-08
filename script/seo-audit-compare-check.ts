/** Real-Postgres check of Site audit → compare with any earlier crawl (server/seo/audit.ts siteAudit `vs`). THROWAWAY database. */
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { ensureSiteScanSchema } from "../server/sitescan/schema";
import { siteAudit } from "../server/seo/audit";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
const H = "https://compare.example";
(async () => {
  await ensureSeoSchema(); await ensureSiteScanSchema();
  await pool.query("DELETE FROM sitescan_jobs WHERE url LIKE 'https://compare.example%'");
  const report = (urls: string[]) => ({ findings: urls.length === 0 ? [] : [{ id: "missing-title", category: "content", severity: "error", title: "Missing title", urls, why: "w", fix: "f" }] });
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
  ok(def.crawls.map((c) => c.jobId).join() === [newest, middle, oldest].join() && def.crawls[2].pageCap === 100, "the pickers list this account's crawls of this site, newest first, with their page limits");
  await pool.query("DELETE FROM sitescan_jobs WHERE url LIKE 'https://compare.example%' OR url LIKE 'https://elsewhere.example%'");
  console.log(`audit compare checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
