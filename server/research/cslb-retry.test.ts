import { afterEach, describe, expect, it, vi } from "vitest";

// Every query answers one generic row: the schedule reads loaded_at/attempted_at from it, a load reads its generation.
vi.mock("../db", () => ({
  pool: { query: vi.fn(async (sql: string) => (/SELECT id, loaded_at, attempted_at/.test(sql)
    ? { rows: [{ id: "cslb-like", loaded_at: "2026-10-15T10:03:32Z", attempted_at: null, key_version: 99 }, { id: "slow", loaded_at: null, attempted_at: null, key_version: 99 }] }
    : { rows: [{ generation: 0, row_count: 0, loaded_at: null, facets: null, key_version: 99, row_shape: 0 }] })) },
}));

import { refreshDueSources, type BulkSource } from "./bulk";

afterEach(() => vi.useRealTimers());

describe("a windowed source that fails is retried in the same pass (CSLB, 2026-10-16)", () => {
  it("tries it again an hour later, ahead of the queue, while its start hours last", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date("2026-10-16T09:39:00Z"));
    const calls: string[] = [];
    let cslbTries = 0;
    const cslb: BulkSource = { id: "cslb-like", state: "CA", label: "x", pageUrl: "https://example.test", everyHours: 20, minRows: 0, utcHours: [9, 10, 11],
      async *load() { calls.push(`cslb@${new Date().toISOString().slice(11, 16)}`); if (++cslbTries === 1) throw new Error("CSLB sent no file (HTTP 200)"); } };
    const slow: BulkSource = { id: "slow", state: "AR", label: "y", pageUrl: "https://example.test", everyHours: 20, minRows: 0,
      async *load() { calls.push("slow"); vi.setSystemTime(Date.now() + 72 * 60_000); throw new Error("done"); } };
    const lines: string[] = [];
    const run = refreshDueSources([cslb, slow], (m) => lines.push(m));
    await vi.runAllTimersAsync();
    await run;
    expect(calls).toEqual(["cslb@09:39", "slow", expect.stringMatching(/^cslb@10:/)]);
    expect(lines[0]).toMatch(/cslb-like: load failed/);
  });
});
