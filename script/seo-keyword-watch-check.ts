/** Real-Postgres check of the keyword watch: snapshots saved before they are charged, compared with the one before, alerts once, the schedule never buys twice. */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { budgetDeps } from "../server/seo/budget";
import { dataforseoDeps } from "../server/seo/dataforseo";
import { keywordWatchDeps, keywordWatchView, runDueKeywordSnapshots, setKeywordWatch, settleKeywordAlerts, takeKeywordSnapshot } from "../server/seo/keyword-watch";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
const row = (keyword: string, rank: number) => ({ keyword_data: { keyword, keyword_info: { search_volume: 500 } }, ranked_serp_element: { serp_item: { rank_group: rank, etv: 30 - rank, relative_url: "/p" } } });
let answer: { keywords: [string, number][]; total?: number } = { keywords: [] }, calls = 0;
(async () => {
  await ensureSeoSchema(); await ensureSeoSchema();
  budgetDeps.allowanceCents = async () => 100000;
  dataforseoDeps.env = () => ({ DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" }) as any;
  keywordWatchDeps.request = (async () => { calls++; return { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.02, result: [{ total_count: answer.total ?? answer.keywords.length, items: answer.keywords.map(([k, r]) => row(k, r)) }] }] }; }) as any;
  keywordWatchDeps.entitled = async () => true;
  await pool.query("DELETE FROM seo_sites WHERE user_id=1 AND domain='kwwatch.example'");
  const { rows: [s] } = await pool.query("INSERT INTO seo_sites(user_id, domain) VALUES(1,'kwwatch.example') RETURNING *");
  const site = () => pool.query("SELECT * FROM seo_sites WHERE id=$1", [s.id]).then((r) => r.rows[0]);
  const spent = () => pool.query("SELECT count(*)::int n FROM seo_reservations WHERE user_id=1 AND label LIKE 'Keyword snapshot%'").then((r) => r.rows[0].n).catch(() => -1);

  // 1. An earlier snapshot (a month ago), then one now: compared, alerts raised once.
  answer = { keywords: [["roof repair", 4], ["siding", 12], ["gutters", 8]] };
  const first = await takeKeywordSnapshot(await site(), false);
  ok(first.keywords === 3, "a snapshot is saved");
  await pool.query("UPDATE seo_keyword_snapshots SET taken_on = current_date - 30 WHERE id=$1", [first.id]);
  answer = { keywords: [["roof repair", 3], ["metal roofing", 15], ["siding", 14], ["soffit repair", 44]] };
  await takeKeywordSnapshot(await site(), false);
  const v = await keywordWatchView(1, await site());
  ok(v.comparison?.basis === "exact" && v.comparison.added.length === 2 && v.comparison.gone.length === 1, `compared with the one before: ${JSON.stringify({ b: v.comparison?.basis, a: v.comparison?.added.length, g: v.comparison?.gone.length })}`);
  const alerts = () => pool.query("SELECT kind, title FROM seo_alerts WHERE site_id=$1 ORDER BY kind", [s.id]).then((r) => r.rows);
  const a1 = await alerts();
  ok(a1.length === 2 && a1[0].kind === "kw_lost" && a1[1].kind === "kw_new", `one alert each way: ${JSON.stringify(a1)}`);
  ok(/started ranking for 1 search/.test(a1[1].title) && /no longer ranks for 1 search/.test(a1[0].title), "only the changes worth an alert are counted (top 20 new, top 10 lost)");
  ok((await settleKeywordAlerts(s.id)) === 0 && (await alerts()).length === 2, "settling again raises nothing");
  // 2. A retake on the same day replaces the snapshot and is judged again, without a second alert for the day.
  answer = { keywords: [["roof repair", 3], ["siding", 14]] };
  await takeKeywordSnapshot(await site(), false);
  const { rows: snaps } = await pool.query("SELECT taken_on, version, alerts_done, jsonb_array_length(keywords) n FROM seo_keyword_snapshots WHERE site_id=$1 ORDER BY taken_on", [s.id]);
  ok(snaps.length === 2 && snaps[1].version === 2 && snaps[1].n === 2 && snaps[1].alerts_done === true, `one snapshot per day, the newer one kept: ${JSON.stringify(snaps.map((x) => [x.version, x.n, x.alerts_done]))}`);
  ok((await alerts()).length === 2, "the day's alerts are not raised twice");
  // 3. A snapshot cut at the limit never alerts.
  await pool.query("DELETE FROM seo_alerts WHERE site_id=$1", [s.id]);
  await pool.query("UPDATE seo_keyword_snapshots SET taken_on = taken_on - 31 WHERE site_id=$1", [s.id]);
  answer = { keywords: [["roof repair", 3]], total: 900 };
  await takeKeywordSnapshot(await site(), false);
  ok((await keywordWatchView(1, await site())).comparison?.basis === "top" && (await alerts()).length === 0, "cut at the limit: entered / left the top, and no alert");
  // 4. The schedule: off = nothing; on = due at once, bought once, next date a month on; a second pass buys nothing.
  calls = 0;
  ok((await runDueKeywordSnapshots()) === 0 && calls === 0, "not watched: the scheduler takes nothing");
  await setKeywordWatch(2, s.id, true);
  ok(!(await site()).kw_watch, "another account cannot turn it on");
  await setKeywordWatch(1, s.id, true);
  ok((await site()).kw_watch && new Date((await site()).next_kw_snapshot_at).getTime() - Date.now() > 27 * 86400e3, "turned on with a snapshot from today: the next is a month on, not at once");
  await pool.query("DELETE FROM seo_sites WHERE user_id=1 AND domain='kwfresh.example'");
  const { rows: [fresh] } = await pool.query("INSERT INTO seo_sites(user_id, domain) VALUES(1,'kwfresh.example') RETURNING id");
  await setKeywordWatch(1, fresh.id, true);
  ok(new Date((await pool.query("SELECT next_kw_snapshot_at FROM seo_sites WHERE id=$1", [fresh.id])).rows[0].next_kw_snapshot_at) <= new Date(Date.now() + 1000), "turned on with no snapshot: due at once");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [fresh.id]);
  await pool.query("UPDATE seo_sites SET next_kw_snapshot_at = now() - interval '1 minute' WHERE id=$1", [s.id]);
  const done = await runDueKeywordSnapshots();
  const next = new Date((await site()).next_kw_snapshot_at).getTime() - Date.now();
  ok(done === 1 && calls === 1 && next > 27 * 86400e3, `the due snapshot is bought once and the next is a month on (done ${done}, calls ${calls})`);
  const before = calls;
  ok((await runDueKeywordSnapshots()) === 0 && calls === before, "a second pass buys nothing");
  // 5. Saving fails: not charged, and still due.
  await pool.query("UPDATE seo_sites SET next_kw_snapshot_at = now() - interval '1 minute' WHERE id=$1", [s.id]);
  await pool.query("ALTER TABLE seo_keyword_snapshots ADD CONSTRAINT kw_test_block CHECK (total IS DISTINCT FROM 777) NOT VALID");
  answer = { keywords: [["x", 1]], total: 777 };
  const failed: any = await takeKeywordSnapshot(await site(), false).catch((e) => e);
  ok(failed instanceof Error && new Date((await site()).next_kw_snapshot_at) < new Date(), "a snapshot that cannot be saved fails, and the schedule does not move");
  await pool.query("ALTER TABLE seo_keyword_snapshots DROP CONSTRAINT kw_test_block");
  await setKeywordWatch(1, s.id, false);
  ok((await site()).next_kw_snapshot_at === null, "turned off: nothing is due");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [s.id]);
  ok((await pool.query("SELECT 1 FROM seo_keyword_snapshots WHERE site_id=$1", [s.id])).rowCount === 0, "snapshots go with the site");
  console.log(process.exitCode ? "SOME FAILED" : `keyword watch checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
