/** Real-Postgres check of the AI summary's query: the newest answer per question, assistant and month is what comes back. */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { aiSummary } from "../server/seo/ai-summary";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else n++; };
(async () => {
  await ensureSeoSchema();
  const { rows: [s] } = await pool.query("INSERT INTO seo_sites(user_id, domain, business_name) VALUES(1,'aisum.example','Alpine Exteriors') RETURNING id");
  const add = (prompt: string, engine: string, ago: string, mentioned: boolean, extra: { businesses?: string[]; sources?: unknown[]; cited?: boolean; user?: number } = {}) =>
    pool.query(`INSERT INTO seo_ai_checks(user_id, site_id, prompt, engine, mentioned, cited, businesses, sources, created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8, now() - $9::interval)`,
      [extra.user ?? 1, s.id, prompt, engine, mentioned, !!extra.cited, JSON.stringify(extra.businesses ?? []), JSON.stringify(extra.sources ?? []), ago]);
  // One question asked 40 times this month by one assistant (only the newest counts), another asked once.
  for (let i = 40; i >= 1; i--) await add("best roofer in  Bellingham", "chatgpt", `${i} hours`, i === 1, { businesses: ["Skyline", "Alpine Exteriors (Bellingham)"] });
  await add("Best roofer in Bellingham", "gemini", "2 hours", false, { sources: [{ domain: "yelp.com", ours: false }, { domain: "aisum.example", ours: true }], cited: true });
  await add("siding contractor", "chatgpt", "3 hours", false);
  await add("siding contractor", "chatgpt", "70 days", true);            // an earlier month
  await add("someone else's question", "chatgpt", "1 hour", true, { user: 2 });   // another account's row for the same site id: never read
  const out = await aiSummary(1, s.id, { rivals: [], businessName: "Alpine Exteriors", domain: "aisum.example" });
  ok(out.now.answers === 3 && out.now.questions === 2, `now counts one answer per question and assistant: ${JSON.stringify(out.now)}`);
  ok(out.now.mentioned === 1 && out.now.cited === 1, `the newest of the 40 is the one read: ${JSON.stringify(out.now)}`);
  ok(out.byMonth.length === 2 && out.byMonth[out.byMonth.length - 1].answers === 3, `months: ${JSON.stringify(out.byMonth)}`);
  ok(out.businesses.length === 1 && out.businesses[0].name === "Skyline", `the customer's own name is not an "other": ${JSON.stringify(out.businesses)}`);
  ok(out.sources.find((x) => x.domain === "yelp.com")?.directory === "Yelp" && out.sources.find((x) => x.ours)?.domain === "aisum.example", "sources flagged");
  ok(!out.truncated, "not truncated");
  // Like for like from the database: only "siding contractor" on ChatGPT was answered in both months.
  ok(out.compare?.pairs === 1 && out.compare.you.before === 1 && out.compare.you.after === 0 && out.compare.options.length === 1, `like for like over the one shared question: ${JSON.stringify(out.compare)}`);
  ok(out.trend.months.length === 2 && out.trend.you.join() === "1,1" && out.trend.answers.join() === "1,3", `names over time: ${JSON.stringify(out.trend)}`);
  ok((await aiSummary(1, s.id, { rivals: [], vs: "1999-01" })).compare?.from === out.compare?.from, "an unknown month falls back to the default");
  ok((await aiSummary(2, s.id, { rivals: [] })).now.answers === 1, "another account sees only its own rows");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [s.id]);
  console.log("ai summary checks passed:", n); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
