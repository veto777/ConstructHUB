/**
 * Durable Competitor Intel execution (COMP-1). No database: the pool is a
 * recorder whose answers each test programs, and the worker's clock is a
 * plain object the test advances by hand — the lease, backoff, recovery and
 * exactly-once settlement rules are proven against the SQL the module emits
 * and the order it emits it in. (The sitescan suite proves its lease rules
 * the same way; its integration.test.ts covers the Postgres side.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  calls: [] as { sql: string; params: any[]; result?: { rows: any[]; rowCount: number } }[],
  handler: null as null | ((sql: string, params: any[]) => Promise<{ rows: any[]; rowCount: number }>),
}));
vi.mock("../db", () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    const call: { sql: string; params: any[]; result?: any } = { sql, params };
    db.calls.push(call);
    call.result = db.handler ? await db.handler(sql, params) : { rows: [], rowCount: 1 };
    return call.result;
  });
  // Transactions run on a client whose statements land in the same recorder.
  return { pool: { query, connect: vi.fn(async () => ({ query, release: () => {} })) } };
});
vi.mock("../ops/issues", () => ({ recordFailure: vi.fn(async () => {}) }));

import { PlacesStatusError } from "../competitor-provider";
import * as store from "./store";
import { PROVIDER_FAILED } from "./scan";
import {
  SAVE_FAILED,
  LEASE_MS,
  MAX_ATTEMPTS,
  enqueueCompetitorScan,
  cancelCompetitorScan,
  recoverCompetitorScans,
  removeCompetitorScan,
  retryDelayMs,
  runCompetitorWorker,
} from "./worker";

let now: Date;
const clock = { now: () => now };
const advance = (ms: number) => { now = new Date(now.getTime() + ms); };
const T0 = "2026-10-11T12:00:00.000Z";

const job = (over: any = {}) => ({
  id: 7, user_id: 3, industry: "Roofing Contractor", location: "Tampa, FL",
  lat: null, lon: null, radius: 25, status: "running", total_found: 0,
  error_message: null, created_at: now, lease_token: "tok", lease_until: now,
  run_at: now, attempts: 1, abandoned: 0, quota_key: "quota:user:3:competitorScans:2026-10",
  quota_amount: 1, quota_refunded: false, started_at: null, finished_at: null,
  ...over,
});
const place = (id: string, over: any = {}) => ({ place_id: id, name: `Biz ${id}`, formatted_address: "1 Main St", rating: 4.5, user_ratings_total: 12, types: ["roofing_contractor"], ...over });
const found2 = { center: { lat: 27.9, lng: -82.4 }, places: [place("a"), place("b")], complete: true };

const okExec = (places: any = found2, over: any = {}) => ({
  apiKey: "key",
  places: vi.fn(async () => places),
  getDetails: vi.fn(async () => ({ reviews: [], phone: null, website: null })),
  analyzeReviews: vi.fn(() => ({ totalAnalyzed: 0 })),
  analyzeBsScore: vi.fn(() => ({ score: 10, reasons: ["r"] })),
  sleep: vi.fn(async () => {}),
  ...over,
});

const calls = (re: RegExp) => db.calls.filter(c => re.test(c.sql));
const last = (re: RegExp) => calls(re).at(-1);
/** Settlement statements (flag + budget in one statement) and the units they returned. */
const SETTLE = /SET quota_refunded=true/;
const ID_SETTLE = /SET quota_refunded=true\s+WHERE id=\$1/;
const refunded = () => calls(SETTLE).reduce((n, c) => n + Number(c.result?.rows?.[0]?.refunded ?? 0), 0);
beforeEach(() => {
  db.calls.length = 0;
  db.handler = null;
  now = new Date(T0);
});

describe("the backoff schedule", () => {
  it("doubles from 30 s and caps at 15 minutes", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(120_000);
    expect(retryDelayMs(10)).toBe(15 * 60_000);
  });
});

describe("lease claim and heartbeat", () => {
  it("claims the next runnable scan with an attempts bound and a lease window on the fake clock", async () => {
    db.handler = async sql => /SET status='running',lease_token/.test(sql)
      ? { rows: [job()], rowCount: 1 }
      : { rows: [], rowCount: 1 };
    await runCompetitorWorker({ clock, heartbeat: false, exec: okExec() });
    const claim = last(/SET status='running',lease_token/)!;
    expect(claim.params[1].getTime()).toBe(now.getTime() + LEASE_MS); // lease_until
    expect(claim.params[2].getTime()).toBe(now.getTime()); // the same fake instant gates run_at and lease expiry
    expect(claim.params[3]).toBe(MAX_ATTEMPTS);
    expect(claim.sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(last(/SET status='completed'/)?.params[2]).toBe(2); // two places indexed
  });

  it("heartbeats extend the lease while the scan runs", async () => {
    vi.useFakeTimers();
    try {
      let live = true;
      let releaseDetails!: () => void;
      const gate = new Promise<void>(r => { releaseDetails = r; });
      db.handler = async sql => {
        if (/SET status='running',lease_token/.test(sql)) return { rows: [job()], rowCount: 1 };
        if (/SELECT 1 FROM competitor_scans WHERE id=\$1 AND lease_token=\$2/.test(sql)) return { rows: live ? [{}] : [], rowCount: live ? 1 : 0 };
        return { rows: [], rowCount: 1 };
      };
      const exec = okExec(found2, {
        getDetails: vi.fn(async () => { await gate; live = false; return { reviews: [], phone: null, website: null }; }),
      });
      const running = runCompetitorWorker({ clock, exec });
      // Parked on the first details call: two heartbeat periods pass.
      await vi.advanceTimersByTimeAsync(30_000);
      advance(30_000);
      await vi.advanceTimersByTimeAsync(30_000);
      advance(30_000);
      expect(calls(/UPDATE competitor_scans SET lease_until=\$3/)).toHaveLength(2);
      releaseDetails();
      await running;
      const beats = calls(/UPDATE competitor_scans SET lease_until=\$3/);
      expect(beats[0].params[2].getTime()).toBe(new Date(T0).getTime() + LEASE_MS);
      expect(beats[1].params[2].getTime()).toBe(new Date(T0).getTime() + 30_000 + LEASE_MS);
      expect(calls(/SET status='completed'/).length).toBe(0); // it died at the liveness check, quietly
      expect(calls(/SET status='failed',error_message=\$3,finished_at=\$4/).length).toBe(0); // the worker's own fail, not the pre-claim sweep
    } finally { vi.useRealTimers(); }
  });
});

describe("retry with backoff, settlement once", () => {
  it("a transient failure is requeued with a backoff — the reservation is held, never reserved again", async () => {
    let claimed: any = null;
    db.handler = async sql => {
      if (/SET status='running',lease_token/.test(sql)) { claimed = job(); return { rows: [claimed], rowCount: 1 }; }
      if (/SELECT 1 FROM competitor_scans/.test(sql)) return { rows: [{}], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    const exec = okExec(found2, { places: vi.fn(async () => { throw new PlacesStatusError("Competitor search failed (OVER_QUERY_LIMIT). Check provider access and quota.", "OVER_QUERY_LIMIT"); }) });
    await runCompetitorWorker({ clock, heartbeat: false, exec });
    const release = last(/SET status='pending',lease_token=NULL/)!;
    expect(release.params[0]).toBe(claimed.id);
    expect(release.params[2].getTime()).toBe(now.getTime() + retryDelayMs(claimed.attempts));
    expect(calls(/SET status='failed',error_message=\$3,finished_at=\$4/).length).toBe(0); // the worker's own fail, not the pre-claim sweep
    expect(calls(ID_SETTLE)).toHaveLength(0); // nothing settled, nothing re-reserved
    expect(refunded()).toBe(0);
  });

  it("a non-retryable failure is terminal, refunds through the row's CAS, and a second sweep refunds nothing", async () => {
    let refundAnswered = false;
    db.handler = async sql => {
      if (/SET status='running',lease_token/.test(sql)) return { rows: [job()], rowCount: 1 };
      if (ID_SETTLE.test(sql)) {
        if (!refundAnswered) { refundAnswered = true; return { rows: [{ refunded: 1 }], rowCount: 1 }; }
        return { rows: [{ refunded: 0 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    };
    const exec = okExec(found2, { places: vi.fn(async () => { throw new Error("Location could not be geocoded. Use a city and state or a full address."); }) });
    await runCompetitorWorker({ clock, heartbeat: false, exec });
    expect(last(/SET status='failed',error_message/)?.params[2]).toContain("geocoded");
    // Fail, listing cleanup and refund share one transaction under the lease.
    const sqls = db.calls.map(c => c.sql.trim().split(/\s+/).slice(0, 3).join(" "));
    const begin = sqls.lastIndexOf("BEGIN");
    expect(db.calls[begin + 1].sql).toMatch(/SET status='failed'.*\n.*lease_token=\$2/);
    expect(db.calls[begin + 2].sql).toMatch(/DELETE FROM competitor_listings WHERE scan_id=\$1/);
    expect(db.calls[begin + 3].sql).toMatch(ID_SETTLE);
    expect(db.calls[begin + 3].sql).toMatch(/UPDATE growth_budgets/); // flag and balance: one statement
    expect(db.calls[begin + 4].sql).toBe("COMMIT");
    expect(refunded()).toBe(1);
    // The process "restarts": recovery finds the settled row and stays quiet.
    await recoverCompetitorScans(now);
    expect(refunded()).toBe(1);
  });

  it("a scan out of tries fails for good on the next sweep, in plain words, and its month is refunded", async () => {
    db.handler = async sql => {
      if (/SET status='failed',error_message=\$2,finished_at=\$3/.test(sql)) return { rows: [{ id: 9 }], rowCount: 1 };
      if (SETTLE.test(sql)) return { rows: [{ refunded: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    const summary = await recoverCompetitorScans(now);
    expect(summary.failed).toBe(1);
    const sweep = last(/SET status='failed',error_message=\$2,finished_at=\$3/)!;
    expect(sweep.params[1]).toContain("interrupted");
    expect(sweep.params[1]).toContain("not counted against your monthly limit");
    expect(sweep.sql).toMatch(/DELETE FROM competitor_listings WHERE scan_id IN \(SELECT id FROM d\)/); // no half-index left on a failed card
    expect(refunded()).toBe(1);
  });

  it("a completed scan is never refunded — success keeps the charge", async () => {
    db.handler = async sql => {
      if (/SET status='running',lease_token/.test(sql)) return { rows: [job()], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    await runCompetitorWorker({ clock, heartbeat: false, exec: okExec() });
    expect(calls(/SET status='completed'/)).toHaveLength(1);
    expect(calls(ID_SETTLE)).toHaveLength(0);
    await recoverCompetitorScans(now);
    expect(refunded()).toBe(0);
  });

  it("no API key fails fast with the provider-unconfigured message — no retry, no charge", async () => {
    db.handler = async sql => {
      if (/SET status='running',lease_token/.test(sql)) return { rows: [job()], rowCount: 1 };
      if (ID_SETTLE.test(sql)) return { rows: [{ refunded: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    await runCompetitorWorker({ clock, heartbeat: false, exec: okExec(found2, { apiKey: null }) });
    expect(last(/SET status='failed',error_message/)?.params[2]).toContain("Google Places is not configured");
    expect(calls(/SET status='pending',lease_token=NULL/)).toHaveLength(0); // no retry for config errors
    expect(refunded()).toBe(1);
  });
});

describe("recovery and takeover across a restart", () => {
  it("a young lease-less running row is left alone: the grace cutoff rides the fake clock", async () => {
    await recoverCompetitorScans(now);
    const select = last(/SELECT id,attempts FROM competitor_scans WHERE status='running'/)!;
    expect(select.params[1].getTime()).toBe(now.getTime() - 5 * 60_000);
    expect(select.params[0].getTime()).toBe(now.getTime());
    advance(6 * 60_000);
    await recoverCompetitorScans(now);
    const advanced = last(/SELECT id,attempts FROM competitor_scans WHERE status='running'/)!;
    expect(advanced.params[1].getTime()).toBe(now.getTime() - 5 * 60_000);
  });

  it("an expired lease with tries left is requeued with the backoff for the attempts already spent", async () => {
    const stuck = [{ id: 4, attempts: 2 }];
    db.handler = async (sql, params) => {
      if (/SELECT id,attempts FROM competitor_scans WHERE status='running'/.test(sql)) return { rows: stuck, rowCount: stuck.length };
      return { rows: [], rowCount: 1 };
    };
    await recoverCompetitorScans(now);
    const requeue = last(/SET status='pending',lease_token=NULL,lease_until=NULL,abandoned=abandoned\+1,run_at=\$2/)!;
    expect(requeue.params[0]).toBe(4);
    expect(requeue.params[1].getTime()).toBe(now.getTime() + retryDelayMs(2)); // 60 s
    // The requeue re-proves staleness and the attempts it read: a lease renewed or re-claimed since the SELECT is left alone.
    expect(requeue.sql).toMatch(/attempts=\$5 AND \(lease_until IS NOT NULL AND lease_until<\$3 OR lease_until IS NULL AND created_at<\$4\)/);
    expect(requeue.params.slice(2)).toEqual([now, new Date(now.getTime() - 5 * 60_000), 2]);
    // The claim gate uses whatever instant the clock holds when the claim runs:
    // advance past the backoff and the same claim SQL carries the advanced time.
    advance(retryDelayMs(2) - 1);
    await store.claimNextScan("t", new Date(now.getTime() + LEASE_MS), now, MAX_ATTEMPTS);
    const claim = db.calls.find(c => /SET status='running',lease_token/.test(c.sql))!;
    expect((claim.params[2] as Date).getTime()).toBe(now.getTime());
  });

  it("a resumed run re-indexes from a clean slate but keeps each listing's first-seen date", async () => {
    db.handler = async sql => {
      if (/SET status='running',lease_token/.test(sql)) return { rows: [job({ attempts: 2 })], rowCount: 1 };
      if (/SELECT place_id,first_seen_at FROM competitor_listings/.test(sql)) return { rows: [{ place_id: "a", first_seen_at: "2026-09-20T00:00:00Z" }], rowCount: 1 };
      if (/DELETE FROM competitor_listings l USING s/.test(sql)) return { rows: [{ live: 1 }], rowCount: 1 };
      if (/SELECT 1 FROM competitor_scans/.test(sql)) return { rows: [{}], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    await runCompetitorWorker({ clock, heartbeat: false, exec: okExec() });
    const clear = last(/DELETE FROM competitor_listings l USING s/)!;
    expect(clear.sql).toMatch(/lease_token=\$2 AND status='running' FOR SHARE/); // only the live lease may clear
    expect(clear.params).toEqual([7, expect.any(String)]);
    const inserts = calls(/INSERT INTO competitor_listings/);
    expect(inserts).toHaveLength(2);
    expect(inserts[0].params[15].toISOString()).toBe("2026-09-20T00:00:00.000Z"); // place "a" keeps its history
    expect(inserts[1].params[15].toISOString()).toBe(T0); // place "b" is new: first seen now, never NULL (the column is NOT NULL)
  });
});

describe("cancel and delete without orphans", () => {
  it("cancelling an active scan refunds its month exactly once and returns success", async () => {
    db.handler = async sql => {
      if (/SET status='cancelled',lease_token=NULL/.test(sql)) return { rows: [{ id: 7 }], rowCount: 1 };
      if (ID_SETTLE.test(sql)) return { rows: [{ refunded: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    expect(await cancelCompetitorScan(3, 7, now)).toEqual({ ok: true });
    expect(refunded()).toBe(1);
    expect(db.calls.map(c => c.sql.trim().slice(0, 6))).toEqual(["BEGIN", "UPDATE", "WITH r", "COMMIT"]); // cancel + refund commit together
  });

  it("cancelling a finished scan says so; cancelling a missing scan 404s", async () => {
    db.handler = async sql => {
      if (/SET status='cancelled',lease_token=NULL/.test(sql)) return { rows: [], rowCount: 0 };
      if (/SELECT 1 FROM competitor_scans WHERE id=\$1 AND user_id=\$2/.test(sql)) return { rows: [{}], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    expect(await cancelCompetitorScan(3, 7, now)).toEqual({ status: 409, message: "This scan has already finished." });
    db.handler = async sql => /SET status='cancelled',lease_token=NULL/.test(sql) ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 0 };
    expect(await cancelCompetitorScan(3, 7, now)).toEqual({ status: 404, message: "Scan not found" });
  });

  it("delete locks and verifies the owned row first, cancels it, refunds, and removes everything in one transaction", async () => {
    db.handler = async sql => {
      if (/SELECT id,status FROM competitor_scans WHERE id=\$1 AND user_id=\$2 FOR UPDATE/.test(sql)) return { rows: [{ id: 7, status: "running" }], rowCount: 1 };
      if (ID_SETTLE.test(sql)) return { rows: [{ refunded: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    expect(await removeCompetitorScan(3, 7, now)).toBe(true);
    expect(db.calls.map(c => c.sql.trim().split(/\s+/).slice(0, 3).join(" "))).toEqual([
      "BEGIN", "SELECT id,status FROM", "UPDATE competitor_scans SET", "WITH r AS", "DELETE FROM competitor_listings", "DELETE FROM competitor_scans", "COMMIT",
    ]);
    expect(refunded()).toBe(1);
    expect(last(/DELETE FROM competitor_listings/)!.params).toEqual([7, 3]);
  });

  it("delete with another account's scan id touches no listing and no scan", async () => {
    db.handler = async sql => /FOR UPDATE/.test(sql) ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 };
    expect(await removeCompetitorScan(3, 99, now)).toBe(false);
    expect(calls(/DELETE FROM/)).toHaveLength(0);
    expect(calls(SETTLE)).toHaveLength(0);
    expect(calls(/^COMMIT$/)).toHaveLength(1);
  });

  it("an executor whose scan vanished mid-run stops quietly — no failed write, no double refund", async () => {
    db.handler = async sql => {
      if (/SET status='running',lease_token/.test(sql)) return { rows: [job()], rowCount: 1 };
      if (/SELECT 1 FROM competitor_scans WHERE id=\$1 AND lease_token=\$2/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    };
    await runCompetitorWorker({ clock, heartbeat: false, exec: okExec() });
    expect(calls(/INSERT INTO competitor_listings/)).toHaveLength(0);
    expect(calls(/SET status='failed',error_message=\$3,finished_at=\$4/)).toHaveLength(0); // no worker fail; the pre-claim sweep UPDATE is expected
    expect(calls(/SET status='completed'/)).toHaveLength(0);
    expect(calls(ID_SETTLE)).toHaveLength(0);
  });

  it("an insert after the lease is lost writes nothing and stops the run quietly", async () => {
    db.handler = async sql => {
      if (/SET status='running',lease_token/.test(sql)) return { rows: [job()], rowCount: 1 };
      if (/SELECT 1 FROM competitor_scans/.test(sql)) return { rows: [{}], rowCount: 1 }; // live at the check...
      if (/INSERT INTO competitor_listings/.test(sql)) return { rows: [], rowCount: 0 }; // ...cancelled before the write
      return { rows: [], rowCount: 1 };
    };
    await runCompetitorWorker({ clock, heartbeat: false, exec: okExec() });
    const insert = last(/INSERT INTO competitor_listings/)!;
    expect(insert.sql).toMatch(/WITH s AS \(SELECT id FROM competitor_scans WHERE id=\$1 AND lease_token=\$2 AND status='running' FOR SHARE\)/);
    expect(calls(/INSERT INTO competitor_listings/)).toHaveLength(1); // stopped after the refused write
    expect(calls(/SET status='completed'|SET status='failed',error_message=\$3/)).toHaveLength(0);
  });
});

describe("listing rows match the table", () => {
  it("binds the jsonb columns as JSON text and every listing has a first-seen instant", async () => {
    db.handler = async sql => /SET status='running',lease_token/.test(sql) ? { rows: [job()], rowCount: 1 } : { rows: [], rowCount: 1 };
    await runCompetitorWorker({ clock, heartbeat: false, exec: okExec(found2, {
      analyzeReviews: vi.fn(() => ({ totalAnalyzed: 2, themes: ["leak"] })),
      analyzeBsScore: vi.fn(() => ({ score: 40, reasons: ["Keyword-stuffed name", "Few reviews"] })),
    }) });
    const insert = calls(/INSERT INTO competitor_listings/)[0];
    expect(insert.sql).toMatch(/\$13::jsonb,\$14::jsonb,\$15::jsonb/);
    const [bsReasons, reviewAnalysis, rankHistory] = insert.params.slice(12, 15);
    for (const v of [bsReasons, reviewAnalysis, rankHistory]) expect(typeof v).toBe("string"); // node-pg would send a JS array as '{...}', which jsonb rejects
    expect(JSON.parse(bsReasons)).toEqual(["Keyword-stuffed name", "Few reviews"]);
    expect(JSON.parse(reviewAnalysis)).toEqual({ totalAnalyzed: 2, themes: ["leak"] });
    expect(JSON.parse(rankHistory)).toEqual([{ rank: 1, date: T0 }]);
    expect(insert.params[15]).toBeInstanceOf(Date);
  });
});

describe("failure copy on the scan card", () => {
  const failWith = async (exec: any) => {
    db.handler = async sql => {
      if (/SET status='running',lease_token/.test(sql)) return { rows: [job({ attempts: MAX_ATTEMPTS })], rowCount: 1 };
      if (/SELECT 1 FROM competitor_scans/.test(sql)) return { rows: [{}], rowCount: 1 };
      if (/DELETE FROM competitor_listings l USING s/.test(sql)) return { rows: [{ live: 1 }], rowCount: 1 }; // last try: resume clears under the live lease
      if (/INSERT INTO competitor_listings/.test(sql) && exec.dbError) throw exec.dbError;
      return { rows: [], rowCount: 1 };
    };
    await runCompetitorWorker({ clock, heartbeat: false, exec: okExec(found2, exec.over ?? {}) });
    return last(/SET status='failed',error_message=\$3/)?.params[2];
  };

  it("a database error while saving shows plain words, not the driver's message", async () => {
    const msg = await failWith({ dbError: new Error('invalid input syntax for type json') });
    expect(msg).toBe(SAVE_FAILED);
    expect(msg).not.toMatch(/syntax|json/i);
  });

  it("an unexpected provider-side error is shown in plain words", async () => {
    const msg = await failWith({ over: { getDetails: vi.fn(async () => { throw new TypeError("Cannot read properties of undefined (reading 'result')"); }) } });
    expect(msg).toBe(PROVIDER_FAILED);
  });

  it("the provider's own plain messages still reach the card", async () => {
    const msg = await failWith({ over: { getDetails: vi.fn(async () => { throw new Error("Competitor details could not be reached. Please try again later."); }) } });
    expect(msg).toBe("Competitor details could not be reached. Please try again later.");
  });
});

describe("enqueue keeps the API contract", () => {
  it("persists the reservation on the row and returns the camelCase scan shape the client reads", async () => {
    const row = job({ status: "pending", attempts: 0 });
    db.handler = async sql => /INSERT INTO competitor_scans/.test(sql) ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 1 };
    const api = await enqueueCompetitorScan(3, { industry: "Roofing Contractor", location: "Tampa, FL", lat: null, lon: null, radius: 25 }, { key: "quota:user:3:competitorScans:2026-10", remaining: 1 }, now);
    const insert = last(/INSERT INTO competitor_scans/)!;
    expect(insert.params.slice(6, 9)).toEqual(["quota:user:3:competitorScans:2026-10", 1, now]);
    expect(api).toEqual({
      id: 7, userId: 3, industry: "Roofing Contractor", location: "Tampa, FL",
      lat: null, lon: null, radius: 25, status: "pending", totalFound: 0,
      errorMessage: null, createdAt: now.toISOString(),
    });
    expect(Object.keys(api)).not.toContain("lease_token"); // lease internals never leave the server
  });
});
