import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// The poller against the real dev database with a fake portal adapter: no browser, no portal, no mail.
import { pool } from "../db";
import { ensurePermitAlertsSchema } from "./schema";
import { permitAlertDeps, pollJurisdiction, dueJurisdictions, requestPollSoon, PERMIT_POLL_INTERVAL_MS } from "./poller";
import type { PermitRecord, PortalAdapter } from "../scrapers/types";

let userId: number, dbId: number, unsupportedDbId: number, watchId: number, contractorWatchId: number;
const delivered: Array<{ watchId: number; permits: string[] }> = [];
let listing: PermitRecord[] = [];
let listingError: Error | null = null;
let lastSince: string | null = null;

const fake: PortalAdapter = {
  platform: "FakePortal",
  capabilities: { search: ["address"], listRecent: true, detail: false },
  async search() { return []; },
  async listRecent(_ctx, since) { lastSince = since; if (listingError) throw listingError; return listing; },
};
const legacy: PortalAdapter = { ...fake, platform: "LegacyPortal", capabilities: { search: ["address"], listRecent: false, detail: false }, async listRecent() { return []; } };

const rec = (p: Partial<PermitRecord>): PermitRecord => ({ permitNumber: "X", jurisdiction: "Faketown, OR", databaseId: dbId, ...p });

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(url.pathname)) throw new Error("Requires a local development database");
  await ensurePermitAlertsSchema();
  userId = (await pool.query("INSERT INTO users(email) VALUES ('permit-poller-'||gen_random_uuid()||'@example.invalid') RETURNING id")).rows[0].id;
  dbId = (await pool.query("INSERT INTO permit_databases(name, jurisdiction, jurisdiction_type, county_id, platform, search_url, portal_url) VALUES ('PA test Faketown', 'Faketown, OR', 'city', 1, 'FakePortal', 'https://permits.faketown.invalid/search', 'https://permits.faketown.invalid/') RETURNING id")).rows[0].id;
  unsupportedDbId = (await pool.query("INSERT INTO permit_databases(name, jurisdiction, jurisdiction_type, county_id, platform, search_url) VALUES ('PA test Legacy', 'Legacytown, OR', 'city', 1, 'LegacyPortal', 'https://permits.legacy.invalid/') RETURNING id")).rows[0].id;
  watchId = Number((await pool.query(
    `INSERT INTO permit_watches(user_id, kind, name, params, channels, database_ids) VALUES ($1,'trade_area','Roofing in Faketown',$2,$3,$4) RETURNING id`,
    [userId, JSON.stringify({ trades: ["roofing"] }), JSON.stringify({ email: true, sms: false, telegram: false }), [dbId, unsupportedDbId]])).rows[0].id);
  contractorWatchId = Number((await pool.query(
    `INSERT INTO permit_watches(user_id, kind, name, params, channels, database_ids) VALUES ($1,'contractor','Acme',$2,$3,$4) RETURNING id`,
    [userId, JSON.stringify({ contractorName: "Acme Roofing LLC" }), JSON.stringify({ email: true, sms: false, telegram: false }), [dbId]])).rows[0].id);
  permitAlertDeps.getAdapter = (platform) => platform === "FakePortal" ? fake : platform === "LegacyPortal" ? legacy : null;
  permitAlertDeps.browser = async () => { throw new Error("no browser in tests"); };
  permitAlertDeps.geocode = async () => null;
  permitAlertDeps.deliver = async (watch, found) => { delivered.push({ watchId: watch.id, permits: found.map((p) => p.permitNumber) }); return { email: { ok: true } }; };
});
afterAll(async () => {
  await pool.query("DELETE FROM permit_watches WHERE user_id=$1", [userId]);
  await pool.query("DELETE FROM permits WHERE database_id = ANY($1::int[])", [[dbId, unsupportedDbId]]);
  await pool.query("DELETE FROM permit_poll_state WHERE database_id = ANY($1::int[])", [[dbId, unsupportedDbId]]);
  await pool.query("DELETE FROM permit_databases WHERE id = ANY($1::int[])", [[dbId, unsupportedDbId]]);
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
});
beforeEach(() => { delivered.length = 0; listingError = null; });

describe("permit alerts poller (fake adapter)", () => {
  it("polls only jurisdictions an active watch names, and only when due", async () => {
    const due = await dueJurisdictions(100);
    expect(due).toContain(dbId);
    expect(due).toContain(unsupportedDbId);
  });

  it("first poll: upserts the listing, matches by trade and by contractor, one digest per watch", async () => {
    listing = [
      rec({ permitNumber: "R-1", permitType: "Residential Re-Roof", address: "1 Oak St", contractorName: "Bob's Roofing" }),
      rec({ permitNumber: "P-2", permitType: "Pool", address: "2 Oak St", contractorName: "Acme Roofing, Inc" }),
      rec({ permitNumber: "K-3", permitType: "Kitchen remodel", address: "3 Oak St" }),
    ];
    const out = await pollJurisdiction(dbId);
    expect(out).toMatchObject({ status: "polled", found: 3, newOrChanged: 3, hits: 2 });
    // First poll looks back a week.
    expect(Date.now() - new Date(lastSince!).getTime()).toBeGreaterThan(6 * 24 * 3600_000);
    expect(delivered).toEqual(expect.arrayContaining([
      { watchId, permits: ["R-1"] },
      { watchId: contractorWatchId, permits: ["P-2"] },
    ]));
    const { rows: hits } = await pool.query("SELECT watch_id, reason, notified_at, channel_results FROM permit_watch_hits WHERE watch_id = ANY($1::bigint[]) ORDER BY watch_id", [[watchId, contractorWatchId]]);
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.notified_at && h.channel_results?.email?.ok)).toBe(true);
    const { rows: [state] } = await pool.query("SELECT last_success_at, last_error, failing_since, last_count, next_poll_at FROM permit_poll_state WHERE database_id=$1", [dbId]);
    expect(state.last_error).toBeNull();
    expect(state.failing_since).toBeNull();
    expect(state.last_count).toBe(3);
    expect(new Date(state.next_poll_at).getTime() - new Date(state.last_success_at).getTime()).toBe(PERMIT_POLL_INTERVAL_MS);
    const { rows: [w] } = await pool.query("SELECT last_checked_at, last_matched_at FROM permit_watches WHERE id=$1", [watchId]);
    expect(w.last_checked_at).not.toBeNull();
    expect(w.last_matched_at).not.toBeNull();
  });

  it("second poll: the same listing sends nothing; a new matching permit sends one more digest", async () => {
    await requestPollSoon([dbId]);
    let out = await pollJurisdiction(dbId);
    expect(out).toMatchObject({ status: "polled", found: 3, newOrChanged: 0, hits: 0 });
    expect(delivered).toEqual([]);
    // since = last success minus a day of overlap.
    expect(Date.now() - new Date(lastSince!).getTime()).toBeLessThan(2 * 24 * 3600_000);
    listing = [...listing, rec({ permitNumber: "R-4", description: "tear off and reroof", address: "4 Oak St" })];
    out = await pollJurisdiction(dbId);
    expect(out).toMatchObject({ status: "polled", found: 4, newOrChanged: 1, hits: 1 });
    expect(delivered).toEqual([{ watchId, permits: ["R-4"] }]);
    const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM permits WHERE database_id=$1", [dbId]);
    expect(n).toBe(4);
  });

  it("a portal that cannot list by date is marked unsupported and left alone for a day", async () => {
    const out = await pollJurisdiction(unsupportedDbId);
    expect(out.status).toBe("unsupported");
    const { rows: [state] } = await pool.query("SELECT last_error, next_poll_at FROM permit_poll_state WHERE database_id=$1", [unsupportedDbId]);
    expect(state.last_error).toMatch(/not supported/);
    expect(new Date(state.next_poll_at).getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    expect(delivered).toEqual([]);
  });

  it("a 429 backs the jurisdiction off six hours and records the failure without losing the last success", async () => {
    listingError = new Error("Portal answered HTTP 429");
    const out = await pollJurisdiction(dbId);
    expect(out).toMatchObject({ status: "failed", error: "Portal answered HTTP 429" });
    const { rows: [state] } = await pool.query("SELECT last_error, failing_since, last_success_at, next_poll_at FROM permit_poll_state WHERE database_id=$1", [dbId]);
    expect(state.failing_since).not.toBeNull();
    expect(state.last_success_at).not.toBeNull();
    expect(new Date(state.next_poll_at).getTime() - Date.now()).toBeGreaterThan(5 * 3600_000);
    // Back to normal: the error clears.
    listingError = null;
    await pollJurisdiction(dbId);
    const { rows: [ok] } = await pool.query("SELECT last_error, failing_since FROM permit_poll_state WHERE database_id=$1", [dbId]);
    expect(ok.last_error).toBeNull();
    expect(ok.failing_since).toBeNull();
  });

  it("an inactive watch is not matched", async () => {
    await pool.query("UPDATE permit_watches SET active=false WHERE id=$1", [contractorWatchId]);
    listing = [...listing, rec({ permitNumber: "P-5", permitType: "Pool", contractorName: "Acme Roofing LLC" })];
    const out = await pollJurisdiction(dbId);
    expect(out).toMatchObject({ status: "polled", hits: 0 });
    expect(delivered).toEqual([]);
  });
});

vi.setConfig({ testTimeout: 30_000 });
