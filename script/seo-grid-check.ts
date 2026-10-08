/**
 * Real-Postgres check of the local grid's saved scans. Not part of the unit suite.
 * Run on a THROWAWAY database after the other three checks:
 *   DATABASE_URL=postgres://.../seotest npx tsx script/seo-grid-check.ts
 */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { beginScan, runningScan, finishScan, failScan, getScan, listScans, savePin, readPin, buildScan, gridPoints, pinInput, type MapListing } from "../server/seo/grid";
import { saveWatch, listWatches, deleteWatch, raiseGridAlert, raiseOwedGridAlerts, runDueGridWatches, gridReportLines, gridMonitorDeps, watchInput, MAX_WATCHES } from "../server/seo/grid-monitor";
import { gridDeps } from "../server/seo/grid";
import { budgetDeps } from "../server/seo/budget";
import { dataforseoDeps } from "../server/seo/dataforseo";
import { listAlerts } from "../server/seo/alerts";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

async function main() {
  await ensureSeoSchema();
  // Rows that would break "one running scan per site" are closed before the rule is made — twice over, to prove the upgrade repeats safely.
  await pool.query("DROP INDEX IF EXISTS seo_grid_scans_active");
  const { rows: [s] } = await pool.query("INSERT INTO seo_sites(user_id,domain,devices) VALUES(1,'grid.example','desktop') ON CONFLICT(user_id,domain) DO UPDATE SET devices=EXCLUDED.devices RETURNING id");
  await pool.query("DELETE FROM seo_grid_scans WHERE site_id=$1", [s.id]);
  await pool.query("INSERT INTO seo_grid_scans(user_id, site_id, keyword, size, spacing, status) VALUES(1,$1,'old a',3,1,'running'),(1,$1,'old b',3,1,'running')", [s.id]);
  await ensureSeoSchema(); await ensureSeoSchema();
  eq("1 two old running rows: the rule is created, one is closed as interrupted",
    [(await pool.query("SELECT count(*)::int n FROM pg_indexes WHERE indexname='seo_grid_scans_active'")).rows[0].n, (await pool.query("SELECT status FROM seo_grid_scans WHERE site_id=$1 ORDER BY id", [s.id])).rows.map((r) => r.status)], [1, ["failed", "running"]]);
  await pool.query("DELETE FROM seo_grid_scans WHERE site_id=$1", [s.id]);

  const pin = pinInput.parse({ name: "Grid Co", lat: 48.7, lng: -122.4, cid: "12", domain: "grid-listing.example" });
  await savePin(1, s.id, pin);
  eq("2 the pin reads back, with the listing's own website", [readPin((await pool.query("SELECT grid_pin FROM seo_sites WHERE id=$1", [s.id])).rows[0].grid_pin)?.cid, readPin((await pool.query("SELECT grid_pin FROM seo_sites WHERE id=$1", [s.id])).rows[0].grid_pin)?.domain], ["12", "grid-listing.example"]);

  const first = await beginScan(1, s.id, { keyword: "k", size: 3, spacing: 2 });
  const second = await beginScan(1, s.id, { keyword: "other", size: 5, spacing: 2 });
  eq("3 a second scan while one runs returns the first", [first.existing, second.existing, second.id === first.id, (await pool.query("SELECT count(*)::int n FROM seo_grid_scans WHERE site_id=$1 AND status='running'", [s.id])).rows[0].n], [false, true, true, 1]);
  const raced: any = await pool.query("INSERT INTO seo_grid_scans(user_id, site_id, keyword, size, spacing, status) VALUES(1,$1,'raced',3,1,'running')", [s.id]).catch((e) => e);
  eq("3b the database itself refuses a second running scan for the site", raced?.code, "23505");
  eq("4 another account sees neither the running scan nor its detail", [await runningScan(2, s.id), await getScan(2, s.id, first.id)], [null, null]);

  const cells = gridPoints(pin, 3, 2);
  const scan = buildScan({ keyword: "k", size: 3, spacing: 2, pin, domain: "grid.example" }, cells, cells.map(() => [{ name: "Grid Co", rank: 2, cid: "12", domain: null, address: null, lat: null, lng: null, rating: null, reviews: null }]));
  eq("5 finishing writes the results once", [await finishScan(first.id, scan, 0.018), await finishScan(first.id, scan, 0.018)], [true, false]);
  const done = await getScan(1, s.id, first.id), list = await listScans(1, s.id);
  eq("5b it reads back, with the listing it was centred on", [done?.status, done?.scan?.summary.avgRank, list.map((x) => [x.keyword, x.status, x.avgRank, x.checked, x.center?.cid])], ["done", 2, [["k", "done", 2, 9, "12"]]]);

  const stale = await beginScan(1, s.id, { keyword: "k2", size: 3, spacing: 2 });
  await pool.query("UPDATE seo_grid_scans SET created_at = now() - interval '30 minutes' WHERE id=$1", [stale.id]);
  const seen = await getScan(1, s.id, stale.id);
  eq("6 a scan left running by a restart is closed (not just shown) as interrupted, and a new one can start",
    [seen?.status, !!seen?.error, (await pool.query("SELECT status FROM seo_grid_scans WHERE id=$1", [stale.id])).rows[0].status, await runningScan(1, s.id), (await beginScan(1, s.id, { keyword: "k3", size: 3, spacing: 2 })).existing], ["failed", true, "failed", null, false]);
  const last = await runningScan(1, s.id);
  await failScan(last!.id, "No data left");
  eq("7 a failed scan stays in the history with its reason", (await listScans(1, s.id)).map((x) => [x.keyword, x.status, x.error ? "reason" : null]), [["k3", "failed", "reason"], ["k", "done", null], ["k2", "failed", "reason"]]); // k2 was dated half an hour back above, so it is the oldest
  eq("7b a late result cannot overwrite a scan that already failed", await finishScan(last!.id, scan, 0.018), false);

  // Repeating scans, the alert on a clear change, and the report lines.
  await pool.query("DELETE FROM seo_grid_scans WHERE site_id=$1", [s.id]); await pool.query("DELETE FROM seo_grid_watches WHERE site_id=$1", [s.id]); await pool.query("DELETE FROM seo_alerts WHERE site_id=$1", [s.id]);
  const listing = (name: string, rank: number, cid: string): MapListing => ({ name, rank, cid, domain: null, address: null, lat: null, lng: null, rating: null, reviews: null });
  const scanAt = async (keyword: string, ourRank: number, daysAgo: number) => {
    const b = await beginScan(1, s.id, { keyword, size: 3, spacing: 2 });
    const built = buildScan({ keyword, size: 3, spacing: 2, pin, domain: "grid.example" }, cells, cells.map(() => [listing("A", ourRank === 1 ? 2 : 1, "50"), listing("Grid Co", ourRank, "12")].sort((x, y) => x.rank - y.rank)));
    await finishScan(b.id, built, 0.018);
    await pool.query("UPDATE seo_grid_scans SET created_at = now() - make_interval(days => $2) WHERE id=$1", [b.id, daysAgo]);
    return b.id;
  };
  const noBase: any = await saveWatch(1, s.id, watchInput.parse({ keyword: "never scanned", size: 3, spacing: 2, every: "monthly" })).catch((e) => e);
  eq("8 a scan that was never run cannot be set to repeat", [noBase?.status, /Run this scan once first/.test(String(noBase?.message))], [400, true]);
  const older = await scanAt("roof repair", 1, 30);
  const w = await saveWatch(1, s.id, watchInput.parse({ keyword: "Roof  Repair", size: 3, spacing: 2, every: "monthly" }));
  const again = await saveWatch(1, s.id, watchInput.parse({ keyword: "roof repair", size: 3, spacing: 2, every: "weekly" }));
  eq("8a a repeating scan is one row per search and shape; choosing again changes how often", [w.keyword, again.id === w.id, again.every, (await listWatches(1, s.id)).length, (await listWatches(2, s.id)).length], ["roof repair", true, "weekly", 1, 0]);
  for (let i = 0; i < MAX_WATCHES - 1; i++) { await scanAt(`extra ${i}`, 1, 40); await saveWatch(1, s.id, watchInput.parse({ keyword: `extra ${i}`, size: 3, spacing: 2, every: "monthly" })); }
  await scanAt("one more", 1, 40);
  const tooMany: any = await saveWatch(1, s.id, watchInput.parse({ keyword: "one more", size: 3, spacing: 2, every: "monthly" })).catch((e) => e);
  eq("8b at most five per site, and another account cannot stop one", [tooMany?.status, await deleteWatch(2, s.id, w.id), (await listWatches(1, s.id)).length], [403, false, MAX_WATCHES]);
  const both = await Promise.allSettled([1, 2].map((n) => saveWatch(1, s.id, watchInput.parse({ keyword: "one more", size: 3, spacing: 2, every: "monthly" })).then(() => n)));
  eq("8c two requests at once cannot both slip past the limit", [both.filter((r) => r.status === "fulfilled").length, (await listWatches(1, s.id)).length], [0, MAX_WATCHES]);
  await pool.query("DELETE FROM seo_grid_watches WHERE site_id=$1 AND keyword LIKE 'extra %'", [s.id]);

  const newer = await scanAt("roof repair", 9, 0);
  eq("9 nothing to compare the first scan with", await raiseGridAlert(s.id, older), null);
  eq("9b from first everywhere to ninth everywhere is an alert, raised once", [await raiseGridAlert(s.id, newer), await raiseGridAlert(s.id, newer), (await listAlerts(1, s.id)).length], ["grid_down", "grid_down", 1]);
  const alert: any = (await listAlerts(1, s.id))[0];
  eq("9c the alert says what changed, over the points both scans checked", [alert.kind, /got worse across your area/.test(alert.title), alert.items[0].top3, alert.items[0].wasTop3, alert.items[0].checked], ["grid_down", true, 0, 9, 9]);
  const lines = await gridReportLines(1, s.id);
  eq("10 the report line is the newest scan of the repeating search with the one before it", lines.map((l) => [l.keyword, l.top3, l.checked, l.score, l.previous?.top3, l.previous?.score]), [["roof repair", 0, 9, 9, 9, 1]]);
  eq("10b another account gets no lines", await gridReportLines(2, s.id), []);

  // The scheduler: a period is bought once, whatever stops in the middle.
  budgetDeps.allowanceCents = async () => 100000;
  gridMonitorDeps.entitled = async () => true;
  dataforseoDeps.env = () => ({ DATAFORSEO_LOGIN: "x", DATAFORSEO_PASSWORD: "y" });
  let lookups = 0;
  const realRequest = gridDeps.request;
  gridDeps.request = (async () => { lookups++; return { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.002, result: [{ items: [{ type: "local_pack", title: "A", cid: "50" }, { type: "local_pack", title: "Grid Co", cid: "12" }] }] }] }; }) as any;
  const watchRow = async () => (await pool.query("SELECT next_at, anchor_at, lease_until, lease_token, run_scan_id FROM seo_grid_watches WHERE id=$1", [w.id])).rows[0];
  const owedFor = async () => (await pool.query("SELECT scan_id FROM seo_grid_owed WHERE watch_id=$1 ORDER BY scan_id", [w.id])).rows.map((r) => r.scan_id);
  await pool.query("DELETE FROM seo_alerts WHERE site_id=$1", [s.id]);
  // (a) the process stopped after the scan was saved and before the period was closed: the watch is due, its lease has run out, its scan is done
  const bought = await scanAt("roof repair", 2, 0);
  await pool.query("UPDATE seo_grid_watches SET next_at = now() - interval '3 hours', anchor_at = now() - interval '3 hours', lease_until = now() - interval '1 hour', lease_token = 'dead-worker', run_scan_id = $2 WHERE id=$1", [w.id, bought]);
  lookups = 0;
  const ran = await runDueGridWatches();
  const afterCrash = await watchRow();
  eq("11 a period whose scan was already bought is closed without buying again", [ran, lookups, afterCrash.run_scan_id, afterCrash.lease_token, new Date(afterCrash.next_at) > new Date()], [1, 0, null, null, true]);
  eq("11b ...and its comparison was owed and has been made", [await owedFor(), (await listAlerts(1, s.id)).some((a: any) => a.items?.[0]?.scanId === bought)], [[], true]);
  // (b) an ordinary due watch: one scan, tied to the period, the next date counted from the anchor
  const anchor = new Date(Date.now() - 9 * 864e5); // weekly, anchored nine days ago: it is two days late
  await pool.query("UPDATE seo_grid_watches SET next_at = $2, anchor_at = $2 WHERE id=$1", [w.id, anchor]);
  lookups = 0;
  eq("12 a due watch runs one scan of nine points", [await runDueGridWatches(), lookups], [1, 9]);
  const afterRun = await watchRow();
  eq("12b the next date is a whole number of weeks from the anchor, not a week from today", [Math.round((new Date(afterRun.next_at).getTime() - anchor.getTime()) / 864e5), afterRun.run_scan_id, afterRun.lease_token], [14, null, null]);
  eq("12c running the scheduler again straight away buys nothing", [await runDueGridWatches(), lookups], [0, 9]);
  // (c) a worker whose lease was taken over records nothing
  await pool.query("UPDATE seo_grid_watches SET next_at = now() - interval '1 minute', lease_until = now() + interval '1 hour', lease_token = 'someone-else' WHERE id=$1", [w.id]);
  lookups = 0;
  eq("13 a watch another worker holds is left alone", [await runDueGridWatches(), lookups, (await watchRow()).lease_token], [0, 0, "someone-else"]);
  // (d) a comparison that was owed when the process stopped is made later, and a stopped watch owes nothing
  const owed = await scanAt("roof repair", 9, 0);
  await pool.query("DELETE FROM seo_alerts WHERE site_id=$1", [s.id]);
  await pool.query("UPDATE seo_grid_watches SET lease_until = NULL, lease_token = NULL, next_at = now() + interval '5 days' WHERE id=$1", [w.id]);
  const owedToo = await scanAt("roof repair", 9, 0);
  await pool.query("DELETE FROM seo_grid_owed"); await pool.query("INSERT INTO seo_grid_owed(scan_id, watch_id, site_id) VALUES($2,$1,$3),($4,$1,$3)", [w.id, owed, s.id, owedToo]);
  eq("14 two comparisons can be owed at once (the second does not overwrite the first)", await owedFor(), [owed, owedToo].sort((x, y) => x - y));
  eq("14a owed comparisons are made on a later pass and then cleared", [await raiseOwedGridAlerts(), await owedFor(), (await listAlerts(1, s.id)).length >= 1], [2, [], true]);
  // one that keeps failing waits longer each time and does not block the others
  await pool.query("INSERT INTO seo_grid_owed(scan_id, watch_id, site_id) VALUES(987654,$1,-1),($2,$1,$3)", [w.id, owed, s.id]);
  await pool.query("ALTER TABLE seo_grid_scans ADD COLUMN IF NOT EXISTS tmp_never integer");
  const realQuery = pool.query.bind(pool); let failOnce = true;
  (pool as any).query = (async (sql: any, args: any[]) => { if (failOnce && typeof sql === "string" && /FROM seo_sites WHERE id=\$1/.test(sql) && args?.[0] === -1) { failOnce = false; throw new Error("the database hiccuped"); } return realQuery(sql, args); }) as any;
  const madeNow = await raiseOwedGridAlerts();
  (pool as any).query = realQuery;
  const stuck = (await pool.query("SELECT tries, next_at > now() AS later FROM seo_grid_owed WHERE scan_id=987654")).rows[0];
  eq("14b one that fails is kept, waits before its next try, and the other was still made", [madeNow, stuck, (await owedFor()).includes(owed)], [1, { tries: 1, later: true }, false]);
  await pool.query("DELETE FROM seo_alerts WHERE site_id=$1", [s.id]);
  await pool.query("DELETE FROM seo_grid_owed"); await pool.query("INSERT INTO seo_grid_owed(scan_id, watch_id, site_id) VALUES($2,$1,$3)", [w.id, owed, s.id]);
  await deleteWatch(1, s.id, w.id);
  eq("14c stopping the watch removes what it owed: nothing is said afterwards", [(await pool.query("SELECT count(*)::int n FROM seo_grid_owed")).rows[0].n, await raiseOwedGridAlerts(), (await listAlerts(1, s.id)).length], [0, 0, 0]);
  // the scan was bought and saved but the period could not be closed (the database failed at that moment): not bought again
  await scanAt("roof repair", 1, 3);
  const w2 = await saveWatch(1, s.id, watchInput.parse({ keyword: "roof repair", size: 3, spacing: 2, every: "weekly" }));
  await pool.query("UPDATE seo_grid_watches SET next_at = now() - interval '1 minute', anchor_at = now() - interval '7 days' WHERE id=$1", [w2.id]);
  let failClose = true; lookups = 0;
  (pool as any).query = (async (sql: any, args: any[]) => { if (failClose && typeof sql === "string" && /WITH closed AS/.test(sql)) { failClose = false; throw new Error("the database hiccuped while closing the period"); } return realQuery(sql, args); }) as any;
  const firstPass = await runDueGridWatches();
  (pool as any).query = realQuery;
  const held = (await pool.query("SELECT run_scan_id, lease_token IS NOT NULL AS leased FROM seo_grid_watches WHERE id=$1", [w2.id])).rows[0];
  const boughtScan = (await pool.query("SELECT status FROM seo_grid_scans WHERE id=$1", [held.run_scan_id])).rows[0]?.status;
  eq("16 closing the period failed after the scan was saved: the scan stays tied to the period", [firstPass, lookups, held.run_scan_id !== null, boughtScan], [0, 9, true, "done"]);
  await pool.query("UPDATE seo_grid_watches SET lease_until = now() - interval '1 minute' WHERE id=$1", [w2.id]); // the lease runs out
  lookups = 0;
  eq("16b the next pass closes the period without buying again", [await runDueGridWatches(), lookups, (await pool.query("SELECT run_scan_id, next_at > now() AS moved FROM seo_grid_watches WHERE id=$1", [w2.id])).rows[0]], [1, 0, { run_scan_id: null, moved: true }]);
  await deleteWatch(1, s.id, w2.id);
  // a watch set on the 31st stays on the 31st: the anchor is the day it was set, not its first due date
  await scanAt("anchored", 1, 1);
  const anchored = await saveWatch(1, s.id, watchInput.parse({ keyword: "anchored", size: 3, spacing: 2, every: "monthly" }));
  const an = (await pool.query("SELECT anchor_at, next_at, anchor_at < now() + interval '1 minute' AS anchored_now, next_at > now() + interval '27 days' AS due_next_month FROM seo_grid_watches WHERE id=$1", [anchored.id])).rows[0];
  eq("17 the anchor is when the watch was set; the first run is a period later", [an.anchored_now, an.due_next_month], [true, true]);
  await deleteWatch(1, s.id, anchored.id);
  gridDeps.request = realRequest;

  // A different listing in the same search is not comparable, and is not reported as this business.
  await scanAt("roof repair", 1, 0);
  await saveWatch(1, s.id, watchInput.parse({ keyword: "roof repair", size: 3, spacing: 2, every: "monthly" }));
  await savePin(1, s.id, pinInput.parse({ name: "Grid Co North", lat: 49.2, lng: -122.4, cid: "77" }));
  eq("15 after the listing is changed, the old listing's scans are not in the report", await gridReportLines(1, s.id), []);
  const moved = await beginScan(1, s.id, { keyword: "roof repair", size: 3, spacing: 2 });
  const pin2 = pinInput.parse({ name: "Grid Co North", lat: 49.2, lng: -122.4, cid: "77" });
  await finishScan(moved.id, buildScan({ keyword: "roof repair", size: 3, spacing: 2, pin: pin2, domain: "grid.example" }, gridPoints(pin2, 3, 2), gridPoints(pin2, 3, 2).map(() => [listing("Grid Co North", 1, "77")])), 0.018);
  eq("15b a scan centred on the new listing is not compared with the old one's", await raiseGridAlert(s.id, moved.id), null);
  eq("15c ...and it is the one the report now shows, with nothing before it", (await gridReportLines(1, s.id)).map((l) => [l.keyword, l.top3, l.previous]), [["roof repair", 9, null]]);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
