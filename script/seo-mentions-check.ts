/**
 * Real-Postgres check of unlinked mentions (server/seo/mentions.ts) through the real ledger: what the customer is
 * charged when the whole check is delivered, when the link check fails (only the search), and for the second try of
 * the link check alone; the saved answer and the site's remembered name and places. THROWAWAY database (users 1, 2).
 *   DATABASE_URL=postgres://.../seotest npx tsx script/seo-mentions-check.ts
 */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { budgetDeps, withBudget } from "../server/seo/budget";
import { cached, saveCached, cacheKey } from "../server/seo/reports";
import { fetchMentions, checkLinks, mentionsDeps, MENTIONS_ESTIMATE_USD, MENTIONS_RETRY_USD, type MentionsPage } from "../server/seo/mentions";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
const ok20 = (items: unknown[], cost: number, total = items.length) => ({ status_code: 20000, tasks: [{ status_code: 20000, cost, result: [{ total_count: total, items }] }] });
const item = (d: string, snippet: string) => ({ url: `https://${d}/p`, main_domain: d, domain_rank: 300, content_info: { main_title: `About ${d}`, snippet } });
const charged = async (user = 1) => Number((await pool.query("SELECT coalesce(sum(included_cents + wallet_cents),0)::int c FROM seo_credit_usage WHERE user_id=$1", [user])).rows[0].c);
(async () => {
  await ensureSeoSchema();
  budgetDeps.allowanceCents = async () => 100000;
  const { rows: [site] } = await pool.query("INSERT INTO seo_sites(user_id, domain, business_name) VALUES(1,'mentions.example','Alpine Exteriors') RETURNING *");
  ok("mention_name" in site && "mention_places" in site, "the site keeps a name and places for mentions");
  // 1. Whole check delivered: the search ($0.025) and the link check ($0.025) are both charged — 4x = 20c.
  mentionsDeps.request = (async (_m: string, path: string) => (path.includes("content_analysis") ? ok20([item("a.com", "Alpine Exteriors in Bellingham"), item("b.org", "Alpine Exteriors Tampa")], 0.025) : ok20([{ domain: "a.com", backlinks: 2 }], 0.025))) as any;
  let before = await charged();
  const whole = await withBudget(1, MENTIONS_ESTIMATE_USD, () => fetchMentions("Alpine Exteriors", "mentions.example"));
  ok((await charged()) - before === 20 && whole.data.rows.map((r) => r.linksToYou).join() === "true,false", `whole check: charged ${(await charged()) - before}c`);
  // 2. The link check fails: only the search is charged (10c); the rows say "not known", never "no link".
  mentionsDeps.request = (async (_m: string, path: string) => { if (path.includes("content_analysis")) return ok20([item("a.com", "x")], 0.025); throw Object.assign(new Error("down"), { code: "upstream", costUsd: 0 }); }) as any;
  before = await charged();
  const half = await withBudget(1, MENTIONS_ESTIMATE_USD, () => fetchMentions("Alpine Exteriors", "mentions.example"));
  ok((await charged()) - before === 10 && half.data.linksChecked === false && half.data.rows[0].linksToYou === null, `link check failed: charged ${(await charged()) - before}c, links unknown`);
  // Saved, then completed by a second try that buys only the link check (10c), keeping the rows bought before.
  const key = cacheKey("mentions", ["mentions.example", "alpine exteriors"]);
  await saveCached(1, key, "mentions", half.data, half.costUsd);
  const saved = await cached<MentionsPage>(1, key, 168);
  ok(saved?.rows.length === 1 && saved.linksChecked === false, "the half-done check is saved");
  mentionsDeps.request = (async () => ok20([], 0.025)) as any;
  before = await charged();
  const done = await withBudget(1, MENTIONS_RETRY_USD, async () => { const o = await checkLinks(saved!); if (!o.data.linksChecked) throw new Error("x"); return o; });
  ok((await charged()) - before === 10 && done.data.linksChecked && done.data.rows[0].linksToYou === false && done.data.rows[0].url === saved!.rows[0].url, `second try: link check only, charged ${(await charged()) - before}c`);
  // A second try that fails again charges nothing.
  mentionsDeps.request = (async () => { throw Object.assign(new Error("down"), { code: "upstream", costUsd: 0 }); }) as any;
  before = await charged();
  await withBudget(1, MENTIONS_RETRY_USD, async () => { const o = await checkLinks(saved!); if (!o.data.linksChecked) throw Object.assign(new Error("x"), { costUsd: o.costUsd, costUnknown: o.costUnknown }); return o; }).catch(() => null);
  ok((await charged()) - before === 0, "a second try that fails again charges nothing");
  // Another account does not see this account's saved check.
  ok((await cached<MentionsPage>(2, key, 168)) === null, "another account does not see the saved check");
  // The customer's verdicts: one per site, name and website (a second one replaces it); only the two words; gone with the site.
  const mark = (v: string, page = "a.com/p") => pool.query(`INSERT INTO seo_mention_verdicts(site_id, user_id, name_key, page_key, page_url, verdict) VALUES($1,1,'alpine exteriors',$3,'https://'||$3,$2)
    ON CONFLICT (site_id, name_key, page_key) DO UPDATE SET verdict=excluded.verdict`, [site.id, v, page]);
  await mark("mine"); await mark("not_mine"); await mark("mine", "a.com/other");
  ok((await pool.query("SELECT page_key, verdict FROM seo_mention_verdicts WHERE site_id=$1 ORDER BY page_key", [site.id])).rows.map((r) => `${r.page_key}=${r.verdict}`).join() === "a.com/other=mine,a.com/p=not_mine", "a verdict is per page; a second one on a page replaces the first");
  ok(await mark("maybe").then(() => false, () => true), "only 'mine' or 'not_mine' can be stored");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [site.id]);
  ok((await pool.query("SELECT 1 FROM seo_mention_verdicts WHERE site_id=$1", [site.id])).rowCount === 0, "verdicts go with the site");
  console.log(`mentions checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
