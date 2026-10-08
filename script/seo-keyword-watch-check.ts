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
  // Every snapshot of the site made `days` older. In two moves (far away, then back), so that two rows exactly `days` apart never share a date half-way.
  const age = async (days: number) => { await pool.query("UPDATE seo_keyword_snapshots SET taken_on = taken_on - 100000 WHERE site_id=$1", [s.id]); await pool.query("UPDATE seo_keyword_snapshots SET taken_on = taken_on + 100000 - $2::int WHERE site_id=$1", [s.id, days]); };

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
  // 5b. A claim that ran out and was taken over. The two owners are held apart (each waits on its own gate), so what
  // each one does can be looked at: the first saves nothing, is charged nothing, and leaves the second's claim alone.
  await age(31); calls = 0;
  const gates: (() => void)[] = [];
  keywordWatchDeps.request = (async () => { calls++; await new Promise<void>((r) => gates.push(r)); return { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.02, result: [{ total_count: 1, items: [row("fenced", 1)] }] }] }; }) as any;
  const reservations = () => pool.query("SELECT id, customer_usd::float8 AS customer, settled_at IS NOT NULL AS settled FROM seo_reservations WHERE user_id=1 AND label LIKE 'Keyword snapshot%' ORDER BY created_at, id").then((r) => r.rows);
  const resBefore = (await reservations()).length;
  const stale = takeKeywordSnapshot(await site(), false).then((x) => x, (e) => e);
  while (gates.length < 1) await new Promise((r) => setTimeout(r, 50));
  const token1 = (await site()).kw_snapshot_claim_token;
  await pool.query("UPDATE seo_sites SET kw_snapshot_claim = now() - interval '11 minutes' WHERE id=$1", [s.id]);
  const successor = takeKeywordSnapshot(await site(), false).then((x) => x, (e) => e);
  while (gates.length < 2) await new Promise((r) => setTimeout(r, 50));
  const token2 = (await site()).kw_snapshot_claim_token;
  ok(typeof token1 === "string" && typeof token2 === "string" && token1 !== token2, "the claim that ran out was taken over by a new owner");
  gates[0]();                                    // the displaced owner's request to the source comes back first
  const r1: any = await stale;
  const mid = await site();
  ok(r1 instanceof Error && r1.notSaved === true && (await pool.query("SELECT count(*)::int n FROM seo_keyword_snapshots WHERE site_id=$1 AND taken_on=current_date", [s.id])).rows[0].n === 0, "the displaced owner saves nothing");
  ok(mid.kw_snapshot_claim_token === token2 && mid.kw_snapshot_claim !== null, "…and on its way out leaves the new owner's claim in place");
  const resMid = await reservations();
  ok(resMid.length === resBefore + 2 && resMid[resBefore].settled && resMid[resBefore].customer === 0, `…and its reservation is settled at nothing for the customer (${JSON.stringify(resMid.slice(resBefore))})`);
  gates[1]();
  const r2: any = await successor;
  const resAfter = await reservations();
  ok(!(r2 instanceof Error) && r2.reused === false && (await pool.query("SELECT count(*)::int n FROM seo_keyword_snapshots WHERE site_id=$1 AND taken_on=current_date", [s.id])).rows[0].n === 1 && resAfter[resBefore + 1].settled && resAfter[resBefore + 1].customer > 0, "the new owner's snapshot is the day's one, and it is the one charged");
  ok((await site()).kw_snapshot_claim === null && (await site()).kw_snapshot_claim_token === null, "when the new owner is done, no claim is left behind");
  keywordWatchDeps.request = (async () => { calls++; if (gate) await gate; return { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.02, result: [{ total_count: answer.total === undefined ? answer.keywords.length : answer.total, items: answer.keywords.map(([k, r]) => row(k, r)) }] }] }; }) as any;
  // 5c. The monthly one stands down when its date was moved after it was leased (someone took a snapshot by hand meanwhile).
  await age(31); calls = 0; await pool.query("UPDATE seo_sites SET kw_watch=true, next_kw_snapshot_at = now() + interval '1 month' WHERE id=$1", [s.id]);
  const stood = await takeKeywordSnapshot(await site(), true, "2026-01-01 00:00:00+00");
  ok(stood.reused === true && stood.id === 0 && calls === 0 && (await site()).kw_snapshot_claim === null, "a leased occurrence whose date has moved buys nothing");
  await pool.query("UPDATE seo_sites SET kw_watch=false, next_kw_snapshot_at = NULL WHERE id=$1", [s.id]);
  answer = { keywords: [["brand new", 1], ["second", 2]] }; await takeKeywordSnapshot(await site(), false);   // the day has its snapshot again for what follows
  // 5d. On a day that already has its snapshot, a leased occurrence whose date moved meanwhile leaves the date alone;
  // the occurrence that still holds its lease moves it a month on from the day's snapshot.
  await pool.query("UPDATE seo_sites SET kw_watch=true, next_kw_snapshot_at = current_date - 1 WHERE id=$1", [s.id]);
  const before5d = (await pool.query("SELECT next_kw_snapshot_at::text AS t FROM seo_sites WHERE id=$1", [s.id])).rows[0].t;
  calls = 0; const r5d = await takeKeywordSnapshot(await site(), true, "2026-01-01 00:00:00+00");
  ok(r5d.reused && calls === 0 && (await pool.query("SELECT next_kw_snapshot_at::text AS t FROM seo_sites WHERE id=$1", [s.id])).rows[0].t === before5d, "a displaced occurrence on a day with a snapshot does not move the schedule");
  await takeKeywordSnapshot(await site(), true, before5d);
  ok((await pool.query("SELECT (next_kw_snapshot_at = current_date + interval '1 month') AS moved FROM seo_sites WHERE id=$1", [s.id])).rows[0].moved === true && calls === 0, "the occurrence that holds its lease moves it a month on, buying nothing");
  await pool.query("UPDATE seo_sites SET kw_watch=false, next_kw_snapshot_at = NULL WHERE id=$1", [s.id]);
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
  // 7b. History: every snapshot listed newest first; any two compared by id; the alert's own pair is the same comparison
  // it was raised from; another account's snapshot, the same one twice, or the later one as "before" are refused.
  const hv = await keywordWatchView(1, await site());
  const ids = hv.snapshots.map((x) => x.id);
  ok(hv.snapshots.length >= 3 && hv.snapshotCount === hv.snapshots.length && hv.snapshots.every((x, i) => i === 0 || x.takenOn < hv.snapshots[i - 1].takenOn) && hv.pair?.chosen === false, `snapshots listed newest first (${hv.snapshots.length})`);
  const oldest = ids[ids.length - 1], newest = ids[0];
  const pv = await keywordWatchView(1, await site(), { now: newest, before: oldest });
  ok(pv.pair?.nowId === newest && pv.pair.beforeId === oldest && pv.pair.chosen && pv.comparison?.since === hv.snapshots[hv.snapshots.length - 1].takenOn, "two chosen snapshots are compared");
  const al = (await pool.query("SELECT items FROM seo_alerts WHERE site_id=$1 AND kind IN ('kw_new','kw_lost') ORDER BY id LIMIT 1", [s.id])).rows[0]?.items?.[0];
  if (al?.snapshotId && al?.beforeId) {
    const av = await keywordWatchView(1, await site(), { now: al.snapshotId, before: al.beforeId });
    const listed = new Set((al.keywords as { keyword: string }[]).map((k) => k.keyword));
    const found = [...(av.comparison?.added ?? []), ...(av.comparison?.gone ?? [])].map((k) => k.keyword);
    // (This script moves snapshot dates back to fake the passing months, so the pair is matched by id, not by date.)
    ok(av.pair?.nowId === al.snapshotId && av.pair.beforeId === al.beforeId && [...listed].every((k) => found.includes(k)), `an alert's own pair shows the comparison it was raised from, with every keyword it kept: ${JSON.stringify({ listed: [...listed], found, pair: av.pair })}`);
  } else ok(false, "an alert with its snapshot ids exists to open");
  const refused = async (p: { now: number; before: number }, user = 1) => keywordWatchView(user, await site(), p).then(() => 0, (e) => e?.status ?? e?.statusCode ?? -1);
  ok((await refused({ now: oldest, before: newest })) === 400 && (await refused({ now: newest, before: newest })) === 400 && (await refused({ now: newest, before: 99999999 })) === 404 && (await refused({ now: newest, before: oldest }, 2)) === 404, "the later one as 'before', the same twice, an unknown id and another account's request are refused");
  // 7c. A pair older than the listed snapshots still comes back with both snapshots described; another site of the
  // same account cannot be asked for this site's snapshots.
  await pool.query(`INSERT INTO seo_keyword_snapshots(site_id, user_id, taken_on, location_code, language_code, keywords, total, fetched, alerts_done)
    SELECT $1, 1, current_date - 400 - g, 2840, 'en', '[{"keyword":"old","position":3,"volume":10,"traffic":1,"path":"/"}]'::jsonb, 1, 1, true FROM generate_series(1, 40) g`, [s.id]);
  const deep = (await pool.query("SELECT id FROM seo_keyword_snapshots WHERE site_id=$1 ORDER BY taken_on LIMIT 2", [s.id])).rows.map((r) => r.id);
  const dv = await keywordWatchView(1, await site(), { now: deep[1], before: deep[0] });
  ok(dv.snapshots.length === 36 && dv.snapshotCount > 36 && !dv.snapshots.some((x) => x.id === deep[1]) && dv.pair?.now.id === deep[1] && dv.pair.before.id === deep[0] && dv.pair.now.keywords === 1, "a pair older than the listed 36 comes back with both snapshots described");
  const { rows: [other] } = await pool.query("INSERT INTO seo_sites(user_id, domain) VALUES(1,'kwother.example') RETURNING *");
  ok((await keywordWatchView(1, other, { now: deep[1], before: deep[0] }).then(() => 0, (e) => e?.status)) === 404, "another site of the same account cannot be asked for this site's snapshots");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [other.id]);
  await pool.query("DELETE FROM seo_keyword_snapshots WHERE site_id=$1 AND taken_on < current_date - 400", [s.id]);
  // 8. A site tracked in another country now than its snapshots were taken for: said, not passed off as the current one.
  await pool.query("UPDATE seo_sites SET location_code=2124 WHERE id=$1", [s.id]);
  ok((await keywordWatchView(1, await site())).sameMarket === false, "snapshots from the country the site used to be tracked in are flagged");
  await pool.query("DELETE FROM seo_sites WHERE id=$1", [s.id]);
  ok((await pool.query("SELECT 1 FROM seo_keyword_snapshots WHERE site_id=$1", [s.id])).rowCount === 0, "snapshots go with the site");
  console.log(process.exitCode ? "SOME FAILED" : `keyword watch checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
