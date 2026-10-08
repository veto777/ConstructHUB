/**
 * Real-Postgres check of the local grid's saved scans. Not part of the unit suite.
 * Run on a THROWAWAY database after the other three checks:
 *   DATABASE_URL=postgres://.../seotest npx tsx script/seo-grid-check.ts
 */
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { beginScan, runningScan, finishScan, failScan, getScan, listScans, savePin, readPin, buildScan, gridPoints, pinInput } from "../server/seo/grid";

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

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
