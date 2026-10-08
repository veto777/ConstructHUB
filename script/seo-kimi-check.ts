/**
 * Real-Postgres check of the Kimi audit #1 money fixes. THROWAWAY database (writes rows for users 1 and 2).
 *   1. "Refresh now" and the monthly job at once: one backlink snapshot bought, the other answered from it.
 *   2. The customer is never charged more than was reserved.
 *   3. An answer without a cost: our ledger keeps the estimate (never zero); the customer is not charged an invented price.
 *   4. The short duplicate window of saved copies (fractions of an hour).
 *   5. AI questions: a duplicate within two minutes is answered from the saved run.
 *   6. The site cap counts only sites the account does not have yet.
 */
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { budgetDeps, withBudget } from "../server/seo/budget";
import { seoJobDeps, snapshotBacklinks } from "../server/seo/jobs";
import { dataforseoDeps, request } from "../server/seo/dataforseo";
import { cached, saveCached } from "../server/seo/reports";
import { AI_ENGINE_KEYS, recentAiRun, saveAiAnswers } from "../server/seo/ai-visibility";
import { siteCapRefuses } from "../server/seo/site-cap";

let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
const spend = async (user: number) => {
  const u = await one("SELECT coalesce(sum(included_cents),0)::int inc, coalesce(sum(wallet_cents),0)::int wal FROM seo_credit_usage WHERE user_id=$1", [user]);
  const a = await one("SELECT coalesce(sum(cost_usd),0)::float8 cost FROM seo_api_usage WHERE user_id=$1", [user]);
  return { customerCents: u.inc + u.wal, ourCost: Math.round(a.cost * 1e4) / 1e4 };
};

(async () => {
  await ensureSeoSchema();
  budgetDeps.allowanceCents = async () => 100000;
  dataforseoDeps.env = () => ({ DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" }) as any;

  // 1. Two snapshot purchases of one site on one day, at the same moment: one buys, the other finds it.
  await pool.query("DELETE FROM seo_sites WHERE domain='kimi.example'");
  const site = await one("INSERT INTO seo_sites(user_id, domain, last_backlinks_at, next_backlinks_at) VALUES(1,'kimi.example', now() - interval '40 days', now() - interval '1 hour') RETURNING *");
  let summaries = 0;
  const slow = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));
  seoJobDeps.backlinksSummary = (async () => { summaries++; return slow({ data: { backlinks: 10, referringDomains: 4 } as any, costUsd: 0.02 }); }) as any;
  seoJobDeps.backlinksList = (async () => slow({ data: { items: [], totalCount: 0 } as any, costUsd: 0.02 })) as any;
  seoJobDeps.lostLinks = (async () => slow({ data: { items: [], total: 0 } as any, costUsd: 0.01 })) as any;
  const before1 = await spend(1);
  const [manual, monthly] = await Promise.all([snapshotBacklinks(site, false), snapshotBacklinks(site, true)]);
  const after1 = await spend(1);
  ok(summaries === 1, `the source was asked once, not twice: ${summaries}`);
  ok([manual.reused, monthly.reused].filter(Boolean).length === 1 && manual.id === monthly.id, `one bought it, the other was answered from it: ${JSON.stringify([manual.reused, monthly.reused])}`);
  ok(Math.round((after1.ourCost - before1.ourCost) * 1e4) / 1e4 === 0.04, `one purchase on our ledger: ${after1.ourCost - before1.ourCost}`);
  const row = await one("SELECT count(*)::int c, max(cost_usd)::float8 cost FROM seo_backlink_snapshots WHERE site_id=$1", [site.id]);
  ok(row.c === 1 && row.cost === 0.04, `one snapshot row, with one purchase's cost: ${JSON.stringify(row)}`);
  const again = await snapshotBacklinks(site, false);
  ok(again.reused === true && summaries === 1, "a second refresh the same day buys nothing");

  // 2. The source charging more than we reserved: the customer pays the reservation at most; our ledger keeps the truth.
  const b2 = await spend(2);
  await withBudget(2, 0.05, async () => ({ data: 1, costUsd: 0.10, customerUsd: 0.10 }));
  const a2 = await spend(2);
  ok(a2.customerCents - b2.customerCents === 20 && Math.round((a2.ourCost - b2.ourCost) * 1e4) / 1e4 === 0.1, `customer capped at the $0.05 hold (20c), our ledger $0.10: ${JSON.stringify([b2, a2])}`);

  // 3. A task answered without a cost field: unknown, not free — our ledger keeps the estimate.
  dataforseoDeps.fetch = (async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [] }] }] }) })) as any;
  const b3 = await spend(2);
  await withBudget(2, 0.05, async () => { const r = await request("POST", "/fake/live", [{}]); return { data: r, costUsd: 0 }; });
  const a3 = await spend(2);
  ok(Math.round((a3.ourCost - b3.ourCost) * 1e4) / 1e4 === 0.05 && a3.customerCents === b3.customerCents, `our ledger keeps the $0.05 estimate; the customer is charged nothing invented: ${JSON.stringify([b3, a3])}`);
  dataforseoDeps.fetch = (async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.01, result: [{ items: [] }] }] }) })) as any;
  const b3b = await spend(2);
  await withBudget(2, 0.05, async () => { await request("POST", "/fake/live", [{}]); return { data: 1, costUsd: 0.01 }; });
  const a3b = await spend(2);
  ok(Math.round((a3b.ourCost - b3b.ourCost) * 1e4) / 1e4 === 0.01, "with a cost field, the reported cost is kept as before");

  // 4. A saved copy answers within its window — a fraction of an hour works.
  await saveCached(1, "kimi:dup", "research", { a: 1 }, 0.01);
  ok(JSON.stringify(await cached(1, "kimi:dup", 5 / 60)) === '{"a":1}', "a copy saved a moment ago answers within five minutes");
  await pool.query("UPDATE seo_report_cache SET created_at = now() - interval '10 minutes' WHERE user_id=1 AND key='kimi:dup'");
  ok((await cached(1, "kimi:dup", 5 / 60)) === null, "and not after");

  // 5. AI: the same question to the same assistants in the last two minutes is answered from the saved run.
  const [e1, e2] = AI_ENGINE_KEYS;
  const answer = (engine: string) => ({ engine, model: "m", answer: "a", searches: [], mentioned: true, cited: false, listedAt: 1, businesses: ["X"], sources: [] }) as any;
  const runId = randomUUID();
  await saveAiAnswers(1, site.id, "best  roofer near me", [answer(e1), answer(e2)], 0.02, runId);
  const hit = await recentAiRun(1, site.id, "best roofer near me", [e1, e2], 120);
  ok(hit?.runId === runId && hit.answers.length === 2 && hit.answers[0].engine === e1, "the same question, both assistants, just asked: answered from the saved run");
  ok((await recentAiRun(1, site.id, "best roofer near me", [e1, e2, ...(AI_ENGINE_KEYS[2] ? [AI_ENGINE_KEYS[2]] : ["nope" as any])], 120)) === null, "an assistant not in that run: asked for real");
  ok((await recentAiRun(2, site.id, "best roofer near me", [e1, e2], 120)) === null, "another account never gets this account's answers");
  await pool.query("UPDATE seo_ai_checks SET created_at = now() - interval '5 minutes' WHERE run_id=$1", [runId]);
  ok((await recentAiRun(1, site.id, "best roofer near me", [e1, e2], 120)) === null, "asked again later: a new ask");

  // 6. The site cap: re-adding a site the account has is an update, allowed at the cap; a new one is not.
  await pool.query("DELETE FROM seo_sites WHERE user_id=2");
  for (let i = 0; i < 50; i++) await pool.query("INSERT INTO seo_sites(user_id, domain) VALUES(2, $1)", [`s${i}.cap.example`]);
  ok(!(await siteCapRefuses(2, "s7.cap.example", 50)), "at 50 sites, re-adding one of them is allowed");
  ok(await siteCapRefuses(2, "new.cap.example", 50), "at 50 sites, a new one is refused");
  await pool.query("DELETE FROM seo_sites WHERE domain='s49.cap.example'");
  ok(!(await siteCapRefuses(2, "new.cap.example", 50)), "at 49, a new one is allowed");

  await pool.query("DELETE FROM seo_sites WHERE user_id=2 OR domain='kimi.example'");
  console.log(`kimi checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
