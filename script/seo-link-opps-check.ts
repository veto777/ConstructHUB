/**
 * Real-Postgres check of Site audit → Internal links to add (server/seo/link-opportunities.ts): which crawl and which
 * rank checks are read, that a keyword's NEWEST check decides, that another account's crawl is never read, and that a
 * changed rank check is seen at once (no stale cached answer). Use a THROWAWAY database (users 1 and 2 must exist).
 *   DATABASE_URL=postgres://.../seotest npx tsx script/seo-link-opps-check.ts
 */
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { ensureSiteScanSchema } from "../server/sitescan/schema";
import { linkOpportunities } from "../server/seo/link-opportunities";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
const H = "https://linkopps.example";
const page = (path: string, text: string, links: string[] = [`${H}/`], extra: object = {}) => ({ url: `${H}${path}`, status: 200, noindex: false, title: path, text, links, redirects: [], ...extra });
(async () => {
  await ensureSeoSchema(); await ensureSiteScanSchema();
  await pool.query("DELETE FROM seo_sites WHERE domain='linkopps.example'"); await pool.query("DELETE FROM sitescan_jobs WHERE url LIKE 'https://linkopps.example%'");
  const { rows: [site] } = await pool.query("INSERT INTO seo_sites(user_id, domain) VALUES(1,'linkopps.example') RETURNING id, domain");
  // A printable copy of /roofing listed first (it names /roofing canonical), and a post that links to /roofing only
  // through an old address that redirected there: read from the saved crawl, neither may produce a wrong suggestion.
  const pages = [page("/roofing-print", "Roofing", [`${H}/`], { canonical: `${H}/roofing` }), page("/", "Home", [`${H}/siding`, `${H}/roofing`]), page("/siding", "Siding"),
    page("/roofing", "Roofing", [`${H}/`], { redirects: [`${H}/old-roofing`] }),
    page("/blog/a", "We install vinyl siding and metal roofing."), page("/blog/b", "Metal roofing explained.", [`${H}/old-roofing`]), ...Array.from({ length: 6 }, (_, i) => page(`/about-${i}`, "Family company."))];
  const job = async (user: number, ps: object[], ago: number) => pool.query(
    `INSERT INTO sitescan_jobs(id, user_id, url, page_cap, state, status, report, completed_at) VALUES($1,$2,$3,150,$4,'completed','{}'::jsonb, now() - $5::int * interval '1 hour')`,
    [randomUUID(), user, `${H}/`, JSON.stringify({ pages: ps }), ago]);
  await job(1, pages, 2);
  // Another account's newer crawl of the same domain says no page mentions anything: it must not be read.
  await job(2, [page("/", "Home", [`${H}/siding`]), page("/siding", "Siding")], 0);
  const kw = async (keyword: string) => (await pool.query("INSERT INTO seo_keywords(site_id, user_id, keyword, location_name) VALUES($1,1,$2,'Bellingham, WA') RETURNING id", [site.id, keyword])).rows[0].id;
  const vinyl = await kw("vinyl siding"), metal = await kw("metal roofing");
  const check = (id: number, daysAgo: number, device: string, position: number | null, url: string | null) => pool.query(
    "INSERT INTO seo_rank_checks(keyword_id, site_id, checked_on, device, position, url) VALUES($1,$2,current_date - $3::int,$4,$5,$6) ON CONFLICT (keyword_id, checked_on, device) DO UPDATE SET position=excluded.position, url=excluded.url",
    [id, site.id, daysAgo, device, position, url]);
  // vinyl siding: ranked 5 days ago, NOT ranked in its newest check (yesterday). metal roofing: newest check today, better on mobile.
  await check(vinyl, 5, "desktop", 7, `${H}/siding`); await check(vinyl, 1, "desktop", null, null); await check(vinyl, 1, "mobile", null, null);
  await check(metal, 0, "desktop", 14, `${H}/roofing`); await check(metal, 0, "mobile", 9, `${H}/roofing`);
  // A link planned under the old identity, written another way and pointing at the printable copy of /roofing.
  const { rows: [old] } = await pool.query("INSERT INTO seo_tasks(user_id, site_id, kind, title, target, detail, source) VALUES(1,$1,'page','old','http://www.linkopps.example/blog/a/',$2,'link-opp:9:/blog/a') RETURNING id", [site.id, JSON.stringify({ linkTo: `${H}/roofing-print` })]);
  const a = await linkOpportunities(1, site);
  const migrated = (await pool.query("SELECT source FROM seo_tasks WHERE id=$1", [old.id])).rows[0].source;
  ok(a && migrated === `link-pair:${a.items[0]?.pair}`, `an old link task takes the identity of the same link today (through the copy's canonical): ${migrated} vs ${a?.items[0]?.pair}`);
  ok(a && a.items.length === 1 && a.items[0].keyword === "metal roofing" && a.items[0].from === `${H}/blog/a`, `only the keyword that ranks in its newest check is looked for: ${JSON.stringify(a?.items.map((i) => i.keyword))}`);
  ok(a && a.notRanking === 1, "the keyword that stopped ranking is counted as not ranking, not looked for with its old page");
  ok(a && a.items.length === 1 && a.items[0].to === `${H}/roofing`, `the destination is the ranking page, not its canonical copy, and the post linking through the old address is left alone: ${JSON.stringify(a?.items.map((i) => [i.from, i.to]))}`);
  ok(a && a.items[0].position === 9 && a.items[0].device === "mobile" && a.items[0].place === "Bellingham, WA", `the position says its device and place: ${JSON.stringify(a?.items[0])}`);
  // A same-day change to the rank check is seen at once (the answer is not served from a stale copy).
  await check(metal, 0, "desktop", null, null); await check(metal, 0, "mobile", null, null);
  const b = await linkOpportunities(1, site);
  ok(b && b.items.length === 0 && b.notRanking === 2, `a same-day rank change is seen at once: ${JSON.stringify(b && { items: b.items.length, notRanking: b.notRanking })}`);
  // Another account sees nothing of this site's crawl.
  ok((await linkOpportunities(2, site)) === null || (await linkOpportunities(2, site))!.targets === 0, "another account does not read these rank checks");
  console.log(`link opportunity checks passed: ${n}`);
  await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
