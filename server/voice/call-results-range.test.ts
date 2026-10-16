/**
 * The Results panel's period parser (server/voice/calls.ts parseCallResultsRange): the four presets, a
 * "<1..365>d" count of days the owner typed, and everything else → "30d". Plus the shape of the query that
 * count becomes: `make_interval(days => $n)` with the number as a BOUND parameter, never spliced into the
 * SQL text. Pure — the DB module is mocked, nothing connects.
 */
import { describe, expect, it, vi } from "vitest";
import { Param, SQL, StringChunk } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ executed: [] as any[] }));
vi.mock("../db", () => ({
  db: { execute: vi.fn(async (q: any) => { mocks.executed.push(q); return { rows: [] }; }) },
  pool: { query: vi.fn(async () => ({ rows: [] })) },
}));

import { callResultsSummary, parseCallResultsRange } from "./calls";

describe("parseCallResultsRange", () => {
  it("keeps the presets as typed", () => {
    expect(parseCallResultsRange("7d")).toBe("7d");
    expect(parseCallResultsRange("30d")).toBe("30d");
    expect(parseCallResultsRange("month")).toBe("month");
    expect(parseCallResultsRange("all")).toBe("all");
  });

  it("accepts a typed number of days from 1 to 365", () => {
    expect(parseCallResultsRange("1d")).toBe("1d");
    expect(parseCallResultsRange("2d")).toBe("2d");
    expect(parseCallResultsRange("45d")).toBe("45d");
    expect(parseCallResultsRange("90d")).toBe("90d");
    expect(parseCallResultsRange("364d")).toBe("364d");
    expect(parseCallResultsRange("365d")).toBe("365d");
  });

  it("falls back to 30d outside 1..365", () => {
    expect(parseCallResultsRange("0d")).toBe("30d");
    expect(parseCallResultsRange("366d")).toBe("30d");
    expect(parseCallResultsRange("999d")).toBe("30d");
    expect(parseCallResultsRange("1000d")).toBe("30d");
    expect(parseCallResultsRange("-5d")).toBe("30d");
  });

  it("falls back to 30d for anything that is not a day count", () => {
    expect(parseCallResultsRange("abc")).toBe("30d");
    expect(parseCallResultsRange("")).toBe("30d");
    expect(parseCallResultsRange("d")).toBe("30d");
    expect(parseCallResultsRange("45")).toBe("30d");
    expect(parseCallResultsRange("45D")).toBe("30d");
    expect(parseCallResultsRange("4.5d")).toBe("30d");
    expect(parseCallResultsRange("1e2d")).toBe("30d");
    expect(parseCallResultsRange("45dd")).toBe("30d");
    expect(parseCallResultsRange("week")).toBe("30d");
    expect(parseCallResultsRange("45d; DROP TABLE voice_calls")).toBe("30d");
  });

  it("falls back to 30d for a missing or non-string value", () => {
    expect(parseCallResultsRange(undefined)).toBe("30d");
    expect(parseCallResultsRange(null)).toBe("30d");
    expect(parseCallResultsRange(45)).toBe("30d");
    expect(parseCallResultsRange(true)).toBe("30d");
    expect(parseCallResultsRange({})).toBe("30d");
    // Express gives ?range=7d&range=30d as an array; that is not one period.
    expect(parseCallResultsRange(["7d", "30d"])).toBe("30d");
    // A one-element array stringifies to its only member, so it is the same period the owner typed.
    expect(parseCallResultsRange(["45d"])).toBe("45d");
  });

  it("normalises leading zeros (the regex allows at most three digits)", () => {
    expect(parseCallResultsRange("07d")).toBe("7d");
    expect(parseCallResultsRange("045d")).toBe("45d");
    expect(parseCallResultsRange("000d")).toBe("30d"); // zero days
    expect(parseCallResultsRange("0045d")).toBe("30d"); // four digits never match
    expect(parseCallResultsRange("0365d")).toBe("30d");
  });

  it("does not trim whitespace", () => {
    expect(parseCallResultsRange(" 45d")).toBe("30d");
    expect(parseCallResultsRange("45d ")).toBe("30d");
    expect(parseCallResultsRange(" 7d")).toBe("30d");
    expect(parseCallResultsRange("7d\n")).toBe("30d");
    expect(parseCallResultsRange(" month")).toBe("30d");
    expect(parseCallResultsRange("45 d")).toBe("30d");
  });
});

/**
 * Every string chunk and every bound parameter inside a drizzle `sql` object, in order, without a dialect or a
 * connection. A template hole holding a plain JS value stays a raw value in queryChunks (drizzle wraps it in a
 * Param only when the query is built), so anything that is not SQL text is a parameter.
 */
function flatten(q: unknown, out = { text: "", params: [] as unknown[] }): { text: string; params: unknown[] } {
  const chunks: unknown[] = q instanceof SQL ? q.queryChunks : Array.isArray(q) ? q : [];
  for (const c of chunks) {
    if (c instanceof SQL) flatten(c, out);
    else if (c instanceof StringChunk) out.text += c.value.join("");
    else if (c instanceof Param) out.params.push(c.value);
    else out.params.push(c);
  }
  return out;
}

describe("the typed day count reaches Postgres as a bound parameter", () => {
  it("45d → make_interval(days => $n) with 45 bound, not spliced", async () => {
    mocks.executed.length = 0;
    await callResultsSummary("org-range-test", parseCallResultsRange("45d"), "America/Chicago");
    expect(mocks.executed.length).toBeGreaterThanOrEqual(1);
    for (const q of mocks.executed) {
      const { text, params } = flatten(q);
      expect(text).toContain("make_interval(days =>");
      expect(text).not.toMatch(/days\s*=>\s*45/);
      expect(text).not.toMatch(/\b45\b/);
      expect(params).toContain(45);
      expect(params).toContain("org-range-test");
    }
  });

  it("the presets 'month' and 'all' bind no day count", async () => {
    mocks.executed.length = 0;
    await callResultsSummary("org-range-test", "month", "America/Chicago");
    for (const q of mocks.executed) {
      const { text, params } = flatten(q);
      expect(text).not.toContain("make_interval");
      expect(text).toContain("date_trunc('month'");
      expect(params).toContain("America/Chicago");
    }
    mocks.executed.length = 0;
    await callResultsSummary("org-range-test", "all", "America/Chicago");
    for (const q of mocks.executed) {
      const { text } = flatten(q);
      expect(text).not.toContain("make_interval");
      expect(text).not.toContain("started_at >=");
    }
  });
});

describe("callResultsSummary never falls open to all time (review w3-r2 L4)", () => {
  it.each(["1.5d", "1e3d", "week", "", "0d", "999d"])("an unknown range %j counts the last 30 days", async (range) => {
    mocks.executed.length = 0;
    await callResultsSummary("org-range-test", range as any, "America/Chicago");
    expect(mocks.executed.length).toBeGreaterThanOrEqual(1);
    for (const q of mocks.executed) {
      const { text, params } = flatten(q);
      expect(text).toContain("make_interval(days =>");
      expect(text).toContain("started_at >=");
      expect(params).toContain(30);
    }
  });

  it("a valid typed count is kept (45d binds 45)", async () => {
    mocks.executed.length = 0;
    await callResultsSummary("org-range-test", "45d", "America/Chicago");
    for (const q of mocks.executed) expect(flatten(q).params).toContain(45);
  });
});
