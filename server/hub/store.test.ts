/**
 * The daily token counter on real Postgres (hub_usage_days, store.ts pgUsage)
 * against the development lane DB: the reservation is one conditional
 * statement, so parallel reservations can never take a day past the cap.
 * Rows live on days in the year 2001, so nothing real is touched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

import { pool } from "../db";
import { ensureHubSchema, pgUsage } from "./store";

describe("hub_usage_days: reservations under a cap on real Postgres (lane DB)", () => {
  const days: string[] = [];
  const day = () => { const d = `2001-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`; days.push(d); return d; };

  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    await ensureHubSchema();
    await pool.query("delete from hub_usage_days where day < '2002-01-01'");
  });
  afterAll(async () => {
    await pool.query("delete from hub_usage_days where day = any($1::date[])", [days]);
    await pool.end();
  });

  it("10 parallel reservations against a small cap: only what fits is admitted and the day's total never passes the cap", async () => {
    const d = day();
    const results = await Promise.all(Array.from({ length: 10 }, () => pgUsage.reserve(d, 300, 100, 1000)));
    // 400 each: two fit (800); the third would make 1,200.
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(await pgUsage.today(d)).toMatchObject({ day: d, calls: 2, prompt: 600, completion: 200, total: 800 });
    // Still room for 200, never for 201.
    expect(await pgUsage.reserve(d, 201, 0, 1000)).toBeNull();
    expect(await pgUsage.reserve(d, 200, 0, 1000)).toMatchObject({ total: 1000 });
    expect(await pgUsage.reserve(d, 1, 0, 1000)).toBeNull();
    expect((await pgUsage.today(d)).total).toBe(1000);
  });

  it("the first reservation of a day is checked too; no cap admits anything; settling replaces the reservation", async () => {
    const d = day();
    expect(await pgUsage.reserve(d, 1200, 0, 1000)).toBeNull();
    expect(await pgUsage.today(d)).toMatchObject({ calls: 0, total: 0 });
    expect(await pgUsage.reserve(d, 1200, 400, null)).toMatchObject({ calls: 1, total: 1600 });
    await pgUsage.settle(d, { prompt: 1200, completion: 400 }, { prompt: 900, completion: 150 });
    expect(await pgUsage.today(d)).toMatchObject({ calls: 1, prompt: 900, completion: 150, total: 1050 });
    // A settle can never take the counters below zero.
    await pgUsage.settle(d, { prompt: 5000, completion: 5000 }, { prompt: 0, completion: 0 });
    expect(await pgUsage.today(d)).toMatchObject({ prompt: 0, completion: 0, total: 0 });
    // Counts above the reservation are counted too: the next admission is measured against the real spend.
    const d2 = day();
    expect(await pgUsage.reserve(d2, 100, 0, 1000)).toMatchObject({ total: 100 });
    await pgUsage.settle(d2, { prompt: 100, completion: 0 }, { prompt: 900, completion: 50 });
    expect(await pgUsage.today(d2)).toMatchObject({ total: 950 });
    expect(await pgUsage.reserve(d2, 51, 0, 1000)).toBeNull();
    expect(await pgUsage.reserve(d2, 50, 0, 1000)).toMatchObject({ total: 1000 });
  });
});
