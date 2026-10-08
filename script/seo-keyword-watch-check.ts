/** Real-Postgres check of the keyword watch: one snapshot a day, saved before charged, compared with the one before, alerts once, the schedule and the customer never both buy. */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { budgetDeps } from "../server/seo/budget";
import { dataforseoDeps } from "../server/seo/dataforseo";
import { KeywordWatchBusy, keywordWatchDeps, keywordWatchView, runDueKeywordSnapshots, setKeywordWatch, settleKeywordAlerts, takeKeywordSnapshot } from "../server/seo/keyword-watch";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
const row = (keyword: string, rank: number) => ({ keyword_data: { keyword, keyword_info: { search_volume: 500 } }, ranked_serp_element: { serp_item: { rank_group: rank, etv: 30 - rank, relative_url: "/p" } } });
let answer: { keywords: [string, number][]; total?: number | null } = { keywords: [] }, calls = 0, gate: Promise<void> | null = null;
(async () => {
  await ensureSeoSchema(); await ensureSeoSchema();
  budgetDeps.allowanceCents = async () => 100000;
  dataforseoDeps.env = () => ({ DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" }) as any;
  keywordWatchDeps.request = (async () => { calls++; if (gate) await gate; return { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.02, result: [{ total_count: answer.total === undefined ? answer.keywords.length : answer.total, items: answer.keywords.map(([k, r]) => row(k, r)) }] }] }; }) as any;
  keywordWatchDeps.entitled = async () => true;
  await pool.query("DELETE FROM seo_sites WHERE user_id=1 AND domain IN ('kwwatch.example','kwfresh.example')");
  const { rows: [s] } = await pool.query("INSERT INTO seo_sites(user_id, domain) VALUES(1,'kwwatch.example') RETURNING *");
  const site = () => pool.query("SELECT * FROM seo_sites WHERE id=$1", [s.id]).then((r) => r.rows[0]);
  const alerts = () => pool.query("SELECT kind, title, items FROM seo_alerts WHERE site_id=$1 ORDER BY kind", [s.id]).then((r) => r.rows);
  const age = (days: number) => pool.query("UPDATE seo_keyword_snapshots SET taken_on = taken_on - $2::int WHERE site_id=$1", [s.id, days]);

  // 1. A snapshot a month ago, then one now: compared, alerts raised once, worded as what the data sees.
  answer = { keywords: [["roof repair", 4], ["siding", 12], ["gutters", 8]] };
  const first = await takeKeywordSnapshot(await site(), false);
  ok(first.keywords === 3 && !first.reused, "a snapshot is saved");
  // 2. Asked again the same day: the one there is comes back, nothing is asked of the source, nothing is rewritten.
  calls = 0; answer = { keywords: [["something else", 1]] };
  const again = await takeKeywordSnapshot(await site(), false);
  ok(again.reused && again.id === first.id && calls === 0 && again.keywords === 3, "the same day: the snapshot there is comes back, nothing is bought");
  await age(30);
  answer = { keywords: [["roof repair", 3], ["metal roofing", 15], ["siding", 14], ["soffit repair", 44]] };
  await takeKeywordSnapshot(await site(), false);
  const v = await keywordWatchView(1, await site());
  ok(v.comparison?.basis === "whole" && v.comparison.added.length === 2 && v.comparison.gone.length === 1 && v.latest?.today === true && v.sameMarket, `compared with the one before: ${JSON.stringify({ b: v.comparison?.basis, a: v.comparison?.added.length, g: v.comparison?.gone.length })}`);
  const a1 = await alerts();
  ok(a1.length === 2 && a1[0].kind === "kw_lost" && a1[1].kind === "kw_new", `one alert each way: ${JSON.stringify(a1.map((x) => x.title))}`);
  ok(/^1 search newly seen in the top 20/.test(a1[1].title) && /^1 search no longer seen/.test(a1[0].title) && !/started ranking|no longer ranks/.test(a1[0].title + a1[1].title), "the titles say what the data sees, and count only the changes worth an alert");
  ok(a1[1].items[0].keywords[0].keyword === "metal roofing", "the alert carries the keywords it was raised for");
  ok((await settleKeywordAlerts(s.id)) === 0 && (await alerts()).length === 2, "settling again raises nothing");
  // 3. Cut at the limit, and a total the source did not give: never an alert.
  await pool.query("DELETE FROM seo_alerts WHERE site_id=$1", [s.id]); await age(31);
  answer = { keywords: [["roof repair", 3]], total: 900 };
  await takeKeywordSnapshot(await site(), false);
  ok((await keywordWatchView(1, await site())).comparison?.basis === "top" && (await alerts()).length === 0, "cut at the limit: entered / left the top, and no alert");
  await age(31); answer = { keywords: [["roof repair", 3], ["new one", 2]], total: null };
  await takeKeywordSnapshot(await site(), false);
  ok((await keywordWatchView(1, await site())).comparison?.basis === "unknown" && (await alerts()).length === 0, "a total the source did not give: not known, and no alert");
  // 4. Alerts switched off for the site: none, and the snapshot is still settled (no old news later).
  await age(31); await pool.query("UPDATE seo_keyword_snapshots SET total = jsonb_array_length(keywords) WHERE site_id=$1", [s.id]);
  await pool.query("UPDATE seo_sites SET alerts_enabled=false WHERE id=$1", [s.id]);
  answer = { keywords: [["brand new", 1]] };
  await takeKeywordSnapshot(await site(), false);
  ok((await alerts()).length === 0 && (await pool.query("SELECT count(*)::int n FROM seo_keyword_snapshots WHERE site_id=$1 AND NOT alerts_done", [s.id])).rows[0].n === 0, "alerts off for the site: none raised, nothing left owing");
  await pool.query("UPDATE seo_sites SET alerts_enabled=true WHERE id=$1", [s.id]);
  ok((await settleKeywordAlerts(s.id)) === 0 && (await alerts()).length === 0, "switching alerts back on sends no old news");
  // 5. The customer and the schedule cannot both buy: while one is being taken, a second is refused and buys nothing.
  await age(31); calls = 0;
  let open!: () => void; gate = new Promise<void>((r) => { open = r; });
  answer = { keywords: [["brand new", 1], ["second", 2]] };
  const slow = takeKeywordSnapshot(await site(), false);
  await new Promise((r) => setTimeout(r, 300));
  const busy: any = await takeKeywordSnapshot(await site(), true).catch((e) => e);
  ok(busy instanceof KeywordWatchBusy && calls === 1, `a second one while the first is being taken is refused (${busy?.constructor?.name}, calls ${calls})`);
  open(); gate = null; await slow;
  ok((await site()).kw_snapshot_claim === null && (await pool.query("SELECT count(*)::int n FROM seo_keyword_snapshots WHERE site_id=$1 AND taken_on=current_date", [s.id])).rows[0].n === 1, "the claim is given back, and there is one snapshot for the day");
  // 6. The schedule: off = nothing; on with a snapshot from today = a month on; due = bought once; switched off before its turn = nothing.
  calls = 0;
  ok((await runDueKeywordSnapshots()) === 0 && calls === 0, "not watched: the scheduler takes nothing");
  await setKeywordWatch(2, s.id, true);
  ok(!(await site()).kw_watch, "another account cannot turn it on");
  await setKeywordWatch(1, s.id, true);
  ok((await site()).kw_watch && new Date((await site()).next_kw_snapshot_at).getTime() - Date.now() > 27 * 86400e3, "turned on with a snapshot from today: the next is a month on, not at once");
  const { rows: [fresh] } = await pool.query("INSERT INTO seo_sites(user_id, domain) VALUES(1,'kwfresh.example') RETURNING id");
  await setKeywordWatch(1, fresh.id, true);
  ok(new Date((await pool.query("SELECT next_kw_snapshot_at FROM seo_sites WHERE id=$1", [fresh.id])).rows[0].next_kw_snapshot_at) <= new Date(Date.now() + 1000), "turned on with no snapshot: due at once");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [fresh.id]);
  await age(31); await pool.query("UPDATE seo_sites SET next_kw_snapshot_at = now() - interval '1 minute' WHERE id=$1", [s.id]);
  const done = await runDueKeywordSnapshots();
  const next = new Date((await site()).next_kw_snapshot_at).getTime() - Date.now();
  ok(done === 1 && calls === 1 && next > 27 * 86400e3, `the due snapshot is bought once and the next is a month on (done ${done}, calls ${calls})`);
  ok((await runDueKeywordSnapshots()) === 0 && calls === 1, "a second pass buys nothing");
  // due again, but today's snapshot exists (the customer took it): the schedule buys nothing and moves on a month
  await pool.query("UPDATE seo_sites SET next_kw_snapshot_at = now() - interval '1 minute' WHERE id=$1", [s.id]);
  ok((await runDueKeywordSnapshots()) === 0 && calls === 1 && new Date((await site()).next_kw_snapshot_at).getTime() - Date.now() > 27 * 86400e3, "due on a day that already has a snapshot: nothing bought, next a month on");
  // 7. Saving fails: not charged, and still due.
  await age(31); await pool.query("UPDATE seo_sites SET next_kw_snapshot_at = now() - interval '1 minute' WHERE id=$1", [s.id]);
  await pool.query("ALTER TABLE seo_keyword_snapshots ADD CONSTRAINT kw_test_block CHECK (total IS DISTINCT FROM 777) NOT VALID");
  answer = { keywords: [["x", 1]], total: 777 };
  const before = (await pool.query("SELECT coalesce(sum(customer_usd),0)::float8 c FROM seo_reservations WHERE user_id=1").catch(() => ({ rows: [{ c: 0 }] }))).rows[0].c;
  const failed: any = await takeKeywordSnapshot(await site(), false).catch((e) => e);
  const after = (await pool.query("SELECT coalesce(sum(customer_usd),0)::float8 c FROM seo_reservations WHERE user_id=1").catch(() => ({ rows: [{ c: 0 }] }))).rows[0].c;
  ok(failed instanceof Error && failed.notSaved === true && after === before && new Date((await site()).next_kw_snapshot_at) < new Date() && (await site()).kw_snapshot_claim === null, `a snapshot that cannot be saved fails, charges the customer nothing (${before} -> ${after}), leaves the schedule due and gives the claim back`);
  await pool.query("ALTER TABLE seo_keyword_snapshots DROP CONSTRAINT kw_test_block");
  await setKeywordWatch(1, s.id, false);
  ok((await site()).next_kw_snapshot_at === null, "turned off: nothing is due");
  // 8. A site tracked in another country now than its snapshots were taken for: said, not passed off as the current one.
  await pool.query("UPDATE seo_sites SET location_code=2124 WHERE id=$1", [s.id]);
  ok((await keywordWatchView(1, await site())).sameMarket === false, "snapshots from the country the site used to be tracked in are flagged");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [s.id]);
  ok((await pool.query("SELECT 1 FROM seo_keyword_snapshots WHERE site_id=$1", [s.id])).rowCount === 0, "snapshots go with the site");
  console.log(process.exitCode ? "SOME FAILED" : `keyword watch checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
