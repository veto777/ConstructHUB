/**
 * Real-Postgres check of claim deadlines (server/seo/dataforseo.ts Deadline): paid work under a claim another pass may
 * take over asks the source nothing after the claim's deadline, and a request in flight then is cut off — so an owner
 * whose deadline has passed buys nothing, saves nothing, charges nothing, gives its claim back and leaves the work for
 * the next pass, which buys once. THROWAWAY database.
 */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { budgetDeps } from "../server/seo/budget";
import { dataforseoDeps, DataForSeoError, REQUEST_TIMEOUT_MS } from "../server/seo/dataforseo";
import { takeKeywordSnapshot } from "../server/seo/keyword-watch";
import { takeWatchedCheck } from "../server/seo/mention-watch";
import { snapshotBacklinks } from "../server/seo/jobs";
import { runGridScan } from "../server/seo/grid-monitor";
import { beginScan, failScan, gridEstimateUsd, pinInput, GRID_POINT_USD } from "../server/seo/grid";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
const row = (keyword: string, rank: number) => ({ keyword_data: { keyword, keyword_info: { search_volume: 500 } }, ranked_serp_element: { serp_item: { rank_group: rank, etv: 30 - rank, relative_url: "/p" } } });
const task = (cost: number, result: unknown) => ({ status_code: 20000, tasks: [{ status_code: 20000, status_message: "Ok.", cost, result: [result] }] });
(async () => {
  await ensureSeoSchema();
  budgetDeps.allowanceCents = async () => 100000;
  dataforseoDeps.env = () => ({ DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" }) as any;
  // The source as the real client sees it: every call counted, with its signal; calls past `hangAfter` never answer on
  // their own (they end only when the client cuts them off). Never the network.
  let calls = 0, hangAfter = Infinity, answer: unknown = {};
  const signals: AbortSignal[] = [];
  dataforseoDeps.fetch = (async (_url: any, init: any) => {
    const i = ++calls; signals.push(init.signal);
    if (i > hangAfter) await new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
  await pool.query("DELETE FROM seo_sites WHERE user_id=1 AND domain='kw.deadline.example'");
  const { rows: [s] } = await pool.query("INSERT INTO seo_sites(user_id, domain, business_name) VALUES(1,'kw.deadline.example','Alpine Exteriors') RETURNING *");
  const site = () => pool.query("SELECT * FROM seo_sites WHERE id=$1", [s.id]).then((r) => r.rows[0]);
  const text = (col: string) => pool.query(`SELECT ${col}::text AS t FROM seo_sites WHERE id=$1`, [s.id]).then((r) => r.rows[0].t as string);
  const count = (table: string) => pool.query(`SELECT count(*)::int n FROM ${table} WHERE site_id=$1`, [s.id]).then((r) => r.rows[0].n as number);
  const reservation = (label: string) => pool.query("SELECT actual_usd::float8 AS actual, customer_usd::float8 AS customer, settled_at IS NOT NULL AS settled FROM seo_reservations WHERE user_id=1 AND label LIKE $1 ORDER BY created_at DESC, id DESC LIMIT 1", [label]).then((r) => r.rows[0]);

  // 1. Keyword snapshot under a lease whose deadline has passed: the source is not asked, nothing is saved or charged
  //    (ours included — the request never left), the claim is given back, the site stays due as leased.
  answer = task(0.02, { total_count: 1, items: [row("roof repair", 4)] });
  await pool.query("UPDATE seo_sites SET kw_watch=true, next_kw_snapshot_at = now() + interval '6 hours' WHERE id=$1", [s.id]);
  const lease = await text("next_kw_snapshot_at");
  calls = 0;
  const past: any = await takeKeywordSnapshot(await site(), true, lease, Date.now() - 1).catch((e) => e);
  ok(past instanceof DataForSeoError && past.code === "timeout" && past.costUnknown === false && calls === 0, `keyword snapshot: past its deadline the owner asks the source nothing (${past?.message})`);
  const r1 = await reservation("Keyword snapshot%");
  ok((await count("seo_keyword_snapshots")) === 0 && r1?.settled && r1.customer === 0 && r1.actual === 0, `…saves nothing and charges nothing, ours included: ${JSON.stringify(r1)}`);
  const s1 = await site();
  ok(s1.kw_snapshot_claim === null && s1.kw_snapshot_claim_token === null && (await text("next_kw_snapshot_at")) === lease, "…gives the claim back and leaves the site due as leased");
  const next = await takeKeywordSnapshot(await site(), true, lease);
  ok(!next.reused && next.keywords === 1 && calls === 1 && (await count("seo_keyword_snapshots")) === 1, "…and the next pass buys once and saves the snapshot");

  // 2. The same with the request in flight at the deadline: cut off, nothing saved, the customer pays nothing, and our
  //    ledger keeps the estimate because what the source charged is not known (a timeout, as ever).
  await pool.query("UPDATE seo_keyword_snapshots SET taken_on = taken_on - 31 WHERE site_id=$1", [s.id]);
  await pool.query("UPDATE seo_sites SET next_kw_snapshot_at = now() + interval '6 hours' WHERE id=$1", [s.id]);
  const lease2 = await text("next_kw_snapshot_at");
  hangAfter = 0; calls = 0; signals.length = 0;
  const t0 = Date.now();
  const cut: any = await takeKeywordSnapshot(await site(), true, lease2, Date.now() + 1500).catch((e) => e);
  ok(cut instanceof DataForSeoError && cut.code === "timeout" && cut.costUnknown === undefined && calls === 1 && signals[0]?.aborted === true && Date.now() - t0 < REQUEST_TIMEOUT_MS,
    `keyword snapshot: a request in flight at the deadline is cut off (${cut?.message}; after ${Date.now() - t0}ms)`);
  const r2 = await reservation("Keyword snapshot%");
  ok((await count("seo_keyword_snapshots")) === 1 && r2?.settled && r2.customer === 0 && r2.actual > 0, `…nothing saved, the customer pays nothing, ours keeps the estimate: ${JSON.stringify(r2)}`);
  ok((await site()).kw_snapshot_claim === null && (await text("next_kw_snapshot_at")) === lease2, "…the claim is given back and the site is still due as leased");
  hangAfter = Infinity;

  // 3. Mentions watch under a lease whose deadline has passed.
  await pool.query("UPDATE seo_sites SET mention_watch=true, next_mention_at = now() + interval '6 hours' WHERE id=$1", [s.id]);
  const mlease = await text("next_mention_at");
  const watched = { id: s.id, user_id: 1, domain: "kw.deadline.example", name: "Alpine Exteriors", lease: mlease };
  calls = 0;
  const mpast: any = await takeWatchedCheck(watched, Date.now() - 1).catch((e) => e);
  ok(mpast instanceof DataForSeoError && mpast.costUnknown === false && calls === 0, `mentions watch: past its lease's deadline nothing is asked (${mpast?.message})`);
  const r3 = await reservation("Mentions watch%");
  ok((await count("seo_mention_checks")) === 0 && r3?.settled && r3.customer === 0 && r3.actual === 0 && (await text("next_mention_at")) === mlease, `…nothing saved or charged; the site stays leased for the next pass: ${JSON.stringify(r3)}`);
  answer = task(0.03, { total_count: 0, items: [] });
  const mnext = await takeWatchedCheck(watched);
  ok(mnext !== null && calls === 1 && (await count("seo_mention_checks")) === 1, "…and the next pass buys once and saves the check");

  // 4. Monthly backlink snapshot under a lease whose deadline has passed; then one cut off in flight after its first
  //    lookup answered: saved with the part that arrived, the missing part said to be missing, charged for what arrived.
  await pool.query("UPDATE seo_sites SET last_backlinks_at = now() - interval '1 month', next_backlinks_at = now() + interval '6 hours' WHERE id=$1", [s.id]);
  const blease = await text("next_backlinks_at");
  calls = 0;
  const bpast: any = await snapshotBacklinks(await site(), true, Date.now() - 1).catch((e) => e);
  ok(bpast instanceof DataForSeoError && bpast.costUnknown === false && calls === 0, `backlinks: past its lease's deadline nothing is asked (${bpast?.message})`);
  const r4 = await reservation("Backlink snapshot%");
  ok((await count("seo_backlink_snapshots")) === 0 && r4?.settled && r4.customer === 0 && r4.actual === 0 && (await text("next_backlinks_at")) === blease, `…nothing saved or charged; the site stays leased: ${JSON.stringify(r4)}`);
  answer = task(0.01, { target: "kw.deadline.example", rank: 100, backlinks: 5 });
  hangAfter = 1; calls = 0;
  const partial = await snapshotBacklinks(await site(), true, Date.now() + 1500);
  const saved = (await pool.query("SELECT summary->>'listFailed' AS list_failed FROM seo_backlink_snapshots WHERE id=$1", [partial.id])).rows[0];
  const r5 = await reservation("Backlink snapshot%");
  ok(calls === 2 && saved?.list_failed === "true" && r5?.settled && Math.abs(r5.customer - 0.01) < 1e-9 && r5.actual > 0.01,
    `backlinks: the list lookup cut off at the deadline is saved as missing, the customer pays for the summary only, ours keeps the estimate: ${JSON.stringify({ calls, saved, r5 })}`);
  hangAfter = Infinity;

  // 5. A local grid scan: past its deadline no point is looked up and the scan fails at no charge; cut off midway, the
  //    points that answered are kept, the rest are unknown, the customer pays for the ones that answered.
  const pin = pinInput.parse({ name: "Alpine Exteriors", lat: 48.7583, lng: -122.4626, cid: "9877668871764835558" });
  const gsite = { id: s.id as number, domain: "kw.deadline.example" }, ginput = { keyword: "siding", size: 3, spacing: 1 };
  const first = await beginScan(1, s.id, ginput);
  calls = 0;
  const gpast: any = await runGridScan(1, gsite, pin, ginput, first.id, { label: "Local grid — deadline check", deadline: Date.now() - 1 }).catch((e) => e);
  const r6 = await reservation("Local grid — deadline check");
  ok(gpast instanceof Error && gpast.costUsd === 0 && gpast.costUnknown === false && calls === 0 && r6?.settled && r6.customer === 0 && r6.actual === 0, `local grid: past its deadline no point is looked up, and nothing is charged: ${JSON.stringify(r6)}`);
  await failScan(first.id, "deadline check");
  answer = task(GRID_POINT_USD, { items: [{ type: "local_pack", title: "Alpine Exteriors", cid: pin.cid }] });
  hangAfter = 4; calls = 0;
  const second = await beginScan(1, s.id, ginput);
  const scan = await runGridScan(1, gsite, pin, ginput, second.id, { label: "Local grid — deadline check", deadline: Date.now() + 1500 });
  const unknown = scan.points.filter((p) => p.failed).length;
  ok(scan.summary.checked === 4 && unknown === 5 && calls >= 9 && calls <= 11, `local grid: cut off at its deadline, the points that answered are kept and the rest are unknown (checked ${scan.summary.checked}, unknown ${unknown}, calls ${calls})`);
  const r7 = await reservation("Local grid — deadline check");
  const g = (await pool.query("SELECT status, checked, points FROM seo_grid_scans WHERE id=$1", [second.id])).rows[0];
  ok(r7?.settled && Math.abs(r7.customer - 4 * GRID_POINT_USD) < 1e-9 && r7.actual >= 9 * GRID_POINT_USD - 1e-9 && r7.actual <= gridEstimateUsd(9) + 1e-9 && g.status === "done" && g.checked === 4 && g.points === 9,
    `…the customer pays for the four that answered, ours counts the cut-off tries as unknown, and the saved scan says so: ${JSON.stringify({ r7, g })}`);
  hangAfter = Infinity;

  await pool.query("DELETE FROM seo_sites WHERE id=$1", [s.id]);
  console.log(process.exitCode ? "SOME FAILED" : `deadline checks passed: ${n}`); await pool.end();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
