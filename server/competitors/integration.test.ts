/**
 * Competitor Intel against REAL Postgres (score3 Lane A). The mocked-pool
 * suite (worker.test.ts) cannot see driver serialization, NOT NULL columns,
 * row locks or transaction rollback — this file does, on the lane database.
 *
 * Run: DATABASE_URL=<lane db> npx vitest run server/competitors/integration.test.ts
 * Skipped when DATABASE_URL is empty (the unit-only run). Its own guard
 * accepts only a local constructhub_dev_* database on port 5432.
 *
 * Other dev servers' Competitor workers poll the same lane DB, so nothing
 * here is ever left claimable: every scan row is created already 'running'
 * under this test's own unexpired lease (or terminal), owned by fake user
 * ids, and the worker's execution is driven through runClaimedScan on it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";

vi.mock("../ops/issues", () => ({ recordFailure: vi.fn(async () => {}) }));

const RAW = process.env.DATABASE_URL || "";
function laneDbOnly(raw: string) {
  const u = new URL(raw);
  if (!["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error("competitors integration: local database only");
  if ((u.port || "5432") !== "5432") throw new Error("competitors integration: port 5432 only");
  if (!/^\/constructhub_dev_[a-z0-9_]+$/.test(u.pathname)) throw new Error("competitors integration: constructhub_dev_* lane database only");
}
if (RAW) laneDbOnly(RAW);

import { pool } from "../db";
import { ensureCompetitorWorkerSchema } from "./schema";
import * as store from "./store";
import { runClaimedScan, removeCompetitorScan, cancelCompetitorScan } from "./worker";

const OWNER = 990_000_101;
const OTHER = 990_000_102;
const KEY = `quota:test-competitors-it:${randomUUID()}`;

const place = (id: string, name: string, over: any = {}) => ({
  place_id: `it-${id}`, name, formatted_address: `${id} Main St, Tampa, FL`, rating: 4.6,
  user_ratings_total: 37, types: ["roofing_contractor", "point_of_interest", "establishment"], ...over,
});
const PLACES = [
  place("p1", "Summit Roofing Co."),
  place("p2", "Best Cheap Roofer Tampa Roof Repair Roofing Near Me", { rating: 5, user_ratings_total: 4 }),
  place("p3", "Gulf Coast Exteriors", { rating: 4.2, user_ratings_total: 120 }),
];
const review = (text: string, rating: number) => ({ author_name: "A", rating, text, time: 1_760_000_000, relative_time_description: "a month ago" });
/** The provider stubbed at its boundary; analysis, worker and store are the real ones. */
const exec = {
  apiKey: "test-key",
  places: vi.fn(async () => ({ center: { lat: 27.95, lng: -82.46 }, places: PLACES, complete: true })),
  getDetails: vi.fn(async () => ({
    reviews: [review("Great crew, fixed our leak fast.", 5), review("Late to the appointment and messy.", 2)],
    phone: "(813) 555-0100", website: "https://example.com",
  })),
  sleep: async () => {},
};

async function budgetUsed(): Promise<number> {
  const { rows: [r] } = await pool.query("SELECT used FROM growth_budgets WHERE key=$1 AND period='0'", [KEY]);
  return Number(r.used);
}

/** A scan row this test has already leased (never claimable by another worker). */
async function leasedScan(userId: number, over: { attempts?: number; status?: string; quotaAmount?: number } = {}) {
  const token = randomUUID();
  const { rows: [row] } = await pool.query(
    `INSERT INTO competitor_scans(user_id,industry,location,radius,status,lease_token,lease_until,run_at,attempts,quota_key,quota_amount,started_at)
     VALUES($1,'Roofing Contractor','Tampa, FL',25,$2,$3,now()+interval '10 minutes',now(),$4,$5,$6,now()) RETURNING *`,
    [userId, over.status ?? "running", token, over.attempts ?? 1, KEY, over.quotaAmount ?? 1],
  );
  return { job: row as store.ScanRow, token };
}

const listingCount = async (scanId: number) =>
  Number((await pool.query("SELECT count(*)::int AS n FROM competitor_listings WHERE scan_id=$1", [scanId])).rows[0].n);
const scanRow = async (scanId: number) =>
  (await pool.query("SELECT * FROM competitor_scans WHERE id=$1", [scanId])).rows[0];

describe.skipIf(!RAW)("Competitor Intel on real Postgres", () => {
  beforeAll(async () => {
    await ensureCompetitorWorkerSchema();
    await pool.query("INSERT INTO growth_budgets(key,period,used) VALUES($1,'0',5)", [KEY]);
  });
  afterAll(async () => {
    await pool.query("DELETE FROM competitor_listings WHERE user_id = ANY($1::int[])", [[OWNER, OTHER]]);
    await pool.query("DELETE FROM competitor_scans WHERE user_id = ANY($1::int[])", [[OWNER, OTHER]]);
    await pool.query("DELETE FROM growth_budgets WHERE key=$1", [KEY]);
    await pool.end();
  });

  it("root cause: node-pg sends a JS array as a Postgres array literal, which jsonb rejects", async () => {
    await expect(pool.query("SELECT $1::jsonb", [["a", "b"]])).rejects.toThrow(/invalid input syntax for type json/);
  });

  it("a nonempty scan persists every listing — valid jsonb, a first-seen instant — and completes with its charge kept", async () => {
    const before = await budgetUsed();
    const { job, token } = await leasedScan(OWNER);
    await runClaimedScan(job, token, { heartbeat: false, exec });
    const scan = await scanRow(job.id);
    expect(scan.status).toBe("completed");
    expect(scan.error_message).toBeNull();
    expect(scan.total_found).toBe(3);
    const { rows } = await pool.query(
      `SELECT place_id,business_name,phone,bs_score,first_seen_at,
              jsonb_typeof(bs_reasons) AS reasons_t,jsonb_typeof(review_analysis) AS analysis_t,
              rank_history->0->>'rank' AS rank,review_analysis->>'totalAnalyzed' AS analyzed
         FROM competitor_listings WHERE scan_id=$1 ORDER BY (rank_history->0->>'rank')::int`, [job.id]);
    expect(rows.map(r => r.place_id)).toEqual(["it-p1", "it-p2", "it-p3"]);
    for (const r of rows) {
      expect(r.reasons_t).toBe("array");
      expect(r.analysis_t).toBe("object");
      expect(r.first_seen_at).toBeInstanceOf(Date);
      expect(Math.abs(r.first_seen_at.getTime() - Date.now())).toBeLessThan(60_000);
      expect(r.phone).toBe("(813) 555-0100");
    }
    expect(rows.map(r => r.rank)).toEqual(["1", "2", "3"]);
    expect(rows[0].analyzed).toBe("2");
    expect(await budgetUsed()).toBe(before); // success keeps the charge
  });

  it("a resumed attempt re-indexes but keeps the first-seen date an earlier attempt recorded", async () => {
    const { job, token } = await leasedScan(OWNER, { attempts: 2 });
    await pool.query(
      `INSERT INTO competitor_listings(scan_id,user_id,place_id,business_name,first_seen_at) VALUES($1,$2,'it-p1','Summit Roofing Co.','2026-09-20T00:00:00Z')`,
      [job.id, OWNER]);
    await runClaimedScan(job, token, { heartbeat: false, exec });
    const { rows } = await pool.query("SELECT place_id,first_seen_at FROM competitor_listings WHERE scan_id=$1 ORDER BY place_id", [job.id]);
    expect(rows).toHaveLength(3); // the stale row was cleared, not duplicated
    expect(rows[0].first_seen_at.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(rows[1].first_seen_at.getTime()).toBeGreaterThan(Date.parse("2026-10-01"));
  });

  it("a listing write after the scan was cancelled lands nothing; the cancel refunded its month once", async () => {
    const before = await budgetUsed();
    const { job, token } = await leasedScan(OWNER);
    expect(await cancelCompetitorScan(OWNER, job.id, new Date())).toEqual({ ok: true });
    expect(await budgetUsed()).toBe(before - 1);
    const wrote = await store.insertListing(job.id, OWNER, token, {
      placeId: "it-late", businessName: "Late", address: null, phone: null, website: null, rating: null, reviewCount: 0,
      category: "", bsScore: 0, bsReasons: [], reviewAnalysis: {}, rank: 1, firstSeenAt: new Date(),
    }, new Date());
    expect(wrote).toBe(false);
    expect(await listingCount(job.id)).toBe(0);
    expect(await store.clearListings(job.id, token)).toBe(false); // nor may the stale holder clean up
    expect(await store.refundScanQuota(job.id)).toBe(0); // already settled
    expect(await budgetUsed()).toBe(before - 1);
  });

  it("deleting with another account's scan id is refused and changes neither table; the owner's delete removes both", async () => {
    const { job, token } = await leasedScan(OWNER);
    await runClaimedScan(job, token, { heartbeat: false, exec });
    expect(await listingCount(job.id)).toBe(3);

    expect(await removeCompetitorScan(OTHER, job.id, new Date())).toBe(false);
    expect(await listingCount(job.id)).toBe(3);
    expect((await scanRow(job.id)).status).toBe("completed");

    expect(await removeCompetitorScan(OWNER, job.id, new Date())).toBe(true);
    expect(await listingCount(job.id)).toBe(0);
    expect(await scanRow(job.id)).toBeUndefined();
  });

  it("deleting an active owned scan cancels it and settles its reservation in the same transaction", async () => {
    const before = await budgetUsed();
    const { job } = await leasedScan(OWNER);
    expect(await removeCompetitorScan(OWNER, job.id, new Date())).toBe(true);
    expect(await scanRow(job.id)).toBeUndefined();
    expect(await budgetUsed()).toBe(before - 1);
  });

  it("a refund settles atomically: a failure between the flag and the balance rolls both back; the retry settles exactly once", async () => {
    const before = await budgetUsed();
    const a = await pool.connect(); // the settling session
    const b = new pg.Pool({ connectionString: RAW, max: 1 }); // a competing session holding the budget row
    const locker = await b.connect();
    try {
      await a.query("BEGIN");
      // A terminal, unrefunded scan — uncommitted, so no other process's sweeper can see (or settle) it.
      const { rows: [scan] } = await a.query(
        `INSERT INTO competitor_scans(user_id,industry,location,radius,status,run_at,attempts,quota_key,quota_amount,finished_at)
         VALUES($1,'Roofing Contractor','Tampa, FL',25,'failed',now(),3,$2,1,now()) RETURNING id`, [OWNER, KEY]);
      await a.query("SET LOCAL lock_timeout='300ms'");

      // Inject the failure between the two writes: the flag flip runs, the balance update cannot get its row.
      await locker.query("BEGIN");
      await locker.query("SELECT 1 FROM growth_budgets WHERE key=$1 AND period='0' FOR UPDATE", [KEY]);
      await a.query("SAVEPOINT settle");
      await expect(store.refundScanQuota(scan.id, a)).rejects.toThrow(/lock timeout/);
      await a.query("ROLLBACK TO SAVEPOINT settle");
      const flag = (await a.query("SELECT quota_refunded FROM competitor_scans WHERE id=$1", [scan.id])).rows[0].quota_refunded;
      expect(flag).toBe(false); // not stranded as "refunded" with the balance untouched
      expect(Number((await a.query("SELECT used FROM growth_budgets WHERE key=$1 AND period='0'", [KEY])).rows[0].used)).toBe(before);
      await locker.query("COMMIT");

      // The retry settles flag and balance together, exactly once.
      expect(await store.refundScanQuota(scan.id, a)).toBe(1);
      expect(await store.refundScanQuota(scan.id, a)).toBe(0);
      expect((await a.query("SELECT quota_refunded FROM competitor_scans WHERE id=$1", [scan.id])).rows[0].quota_refunded).toBe(true);
      await a.query("COMMIT");
    } catch (e) {
      await a.query("ROLLBACK").catch(() => {});
      await locker.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      a.release();
      locker.release();
      await b.end();
    }
    expect(await budgetUsed()).toBe(before - 1);
  });

  it("a terminal failure under the lease fails, drops partial listings and refunds in one go", async () => {
    const before = await budgetUsed();
    const { job, token } = await leasedScan(OWNER, { attempts: 3 });
    const failing = { ...exec, getDetails: vi.fn(async (id: string) => {
      if (id === "it-p2") throw new Error("Competitor details failed (HTTP 500).");
      return exec.getDetails();
    }) };
    await runClaimedScan(job, token, { heartbeat: false, exec: failing });
    const scan = await scanRow(job.id);
    expect(scan.status).toBe("failed");
    expect(scan.error_message).toBe("Competitor details failed (HTTP 500).");
    expect(scan.quota_refunded).toBe(true);
    expect(await listingCount(job.id)).toBe(0); // p1 was written, then removed with the failure
    expect(await budgetUsed()).toBe(before - 1);
  });
});
