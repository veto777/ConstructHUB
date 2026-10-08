/** Real-Postgres check of Site audit → Outgoing links (server/seo/outgoing-links.ts): read from the newest crawl of the account's own site. THROWAWAY database. */
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { ensureSiteScanSchema } from "../server/sitescan/schema";
import { siteOutgoingLinks } from "../server/seo/outgoing-links";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
const H = "https://outgo.example";
(async () => {
  await ensureSeoSchema(); await ensureSiteScanSchema();
  await pool.query("DELETE FROM seo_sites WHERE domain='outgo.example'"); await pool.query("DELETE FROM sitescan_jobs WHERE url LIKE 'https://outgo.example%'");
  const { rows: [site] } = await pool.query("INSERT INTO seo_sites(user_id, domain) VALUES(1,'outgo.example') RETURNING id, domain");
  const page = (p: string, links: string[], evidence: object[] = []) => ({ url: `${H}${p}`, status: 200, links: [`${H}/`, ...links], linkEvidence: evidence });
  const job = (user: number, pages: object[], checks: object[], ago: number) => pool.query(
    `INSERT INTO sitescan_jobs(id, user_id, url, page_cap, state, status, report, completed_at) VALUES($1,$2,$3,150,$4,'completed','{"findings":[]}'::jsonb, now() - $5::int * interval '1 hour')`,
    [randomUUID(), user, `${H}/`, JSON.stringify({ pages, linkChecks: checks }), ago]);
  await job(1, [page("/", ["https://supplier.example/a"], [{ target: "https://supplier.example/a", anchor: "Our supplier" }]), page("/b", ["https://gone.example/x"]), ...Array.from({ length: 4 }, (_, i) => page(`/f${i}`, []))], [{ url: "https://gone.example/x", status: 404 }], 2);
  await job(2, [page("/", ["https://someone-else.example/"])], [], 0);   // another account's newer crawl of the same domain
  const out = await siteOutgoingLinks(1, site);
  ok(out && out.linkedDomains.map((d) => d.domain).sort().join() === "gone.example,supplier.example", `the account's own crawl is read: ${JSON.stringify(out?.linkedDomains.map((d) => d.domain))}`);
  ok(out && out.linkedDomains.find((d) => d.domain === "supplier.example")!.examples[0].anchor === "Our supplier", "link text comes from the crawl's evidence");
  ok(out && out.broken.length === 1 && out.broken[0].status === 404 && out.checkedAddresses === 1 && out.uncheckedLinks === 1, "the checked link that answered 404 is listed; the unchecked one is counted apart");
  ok((await siteOutgoingLinks(3, site)) === null, "an account with no crawl of it gets nothing");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [site.id]);
  console.log(`outgoing checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
