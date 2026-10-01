/** Pure helpers of the public API read resources: no database, no server. */
import { describe, it, expect } from "vitest";
import { ApiError, Params, envelope, keyContext, locationScopeSql, ownerScopeSql, pageSchema, readUnits } from "./_shared";
import { insightsQuerySchema, MAX_RANGE_DAYS } from "./insights";
import { apiAllowances, monthResetsAt, API_UNITS_PER_MONTH } from "./account";
import { READ_RESOURCES, registerReadResources } from "./index";

describe("metering hint", () => {
  it("charges one unit per call plus one per 100 rows", () => {
    expect(readUnits(0)).toBe(1);
    expect(readUnits(1)).toBe(1);
    expect(readUnits(99)).toBe(1);
    expect(readUnits(100)).toBe(2);
    expect(readUnits(250)).toBe(3);
    expect(readUnits(-5)).toBe(1);
  });
});

describe("pagination", () => {
  it("defaults, clamps and refuses out-of-range pages", () => {
    expect(pageSchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(pageSchema.parse({ limit: "10", offset: "5" })).toEqual({ limit: 10, offset: 5 });
    expect(() => pageSchema.parse({ limit: "0" })).toThrow();
    expect(() => pageSchema.parse({ limit: "201" })).toThrow();
    expect(() => pageSchema.parse({ offset: "-1" })).toThrow();
    expect(() => pageSchema.parse({ limit: "abc" })).toThrow();
  });
  it("uses the CRM envelope shape", () => {
    expect(envelope([1, 2], 5, { limit: 2, offset: 0 })).toEqual({ data: [1, 2], pagination: { total: 5, limit: 2, offset: 0, hasMore: true } });
    expect(envelope([5], 5, { limit: 2, offset: 4 }).pagination.hasMore).toBe(false);
  });
});

describe("key context", () => {
  it("reads the verified key in camelCase or the row's snake_case", () => {
    expect(keyContext({ apiKey: { id: "key_1", userId: 7, scopes: ["read"] } } as any)).toEqual({ id: "key_1", userId: 7, scopes: ["read"] });
    expect(keyContext({ apiKey: { id: "key_1", user_id: "7", scopes: ["read", "write"] } } as any).userId).toBe(7);
  });
  it("is a 401 without a key", () => {
    expect(() => keyContext({} as any)).toThrow(ApiError);
    try { keyContext({ apiKey: { id: "key_1" } } as any); } catch (e: any) { expect(e.status).toBe(401); expect(e.code).toBe("unauthorized"); }
  });
});

describe("scope SQL", () => {
  const own = { owner: 3, actor: 3, allClients: true, access: null, keyId: "k" };
  const limited = { owner: 3, actor: 9, allClients: false, access: null, keyId: "k" };
  it("pins every table to the owner and numbers its parameters after the caller's", () => {
    const p = new Params();
    p.add("x");
    const sql = locationScopeSql(own, p);
    expect(sql).toContain("l.user_id=$2");
    expect(sql).toContain("$3::boolean");
    expect(sql).toContain("amc.member_id=$4");
    expect(p.values).toEqual(["x", 3, true, 3]);
  });
  it("hides location-less rows from a limited workspace role, never from the owner", () => {
    const p = new Params();
    expect(ownerScopeSql(limited, p, "ph", null)).toBe("ph.user_id=$1 AND $2::boolean");
    expect(p.values).toEqual([3, false]);
    const q = new Params();
    const sql = ownerScopeSql(limited, q, "r", "r.location_id");
    expect(sql).toContain("v.id=r.location_id");
    expect(sql).toContain("amc.member_id=$3");
    expect(q.values).toEqual([3, false, 9]);
  });
});

describe("insights query", () => {
  it("defaults to the last 30 days and refuses bad ranges", () => {
    const q = insightsQuerySchema.parse({});
    expect(q.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((new Date(q.to).getTime() - new Date(q.from).getTime()) / 86_400_000).toBe(29);
    expect(() => insightsQuerySchema.parse({ from: "2026-02-01", to: "2026-01-01" })).toThrow();
    expect(() => insightsQuerySchema.parse({ from: "2020-01-01", to: "2026-01-01" })).toThrow(new RegExp(String(MAX_RANGE_DAYS)));
    expect(() => insightsQuerySchema.parse({ metric: "NOT_A_METRIC" })).toThrow();
    expect(insightsQuerySchema.parse({ from: "2026-01-01", to: "2026-01-31", metric: "CALL_CLICKS" })).toEqual({ from: "2026-01-01", to: "2026-01-31", metric: "CALL_CLICKS" });
  });
});

describe("API allowances", () => {
  it("reads the plan's apiUnitsPerMonth when present and falls back to the contract values", () => {
    expect(apiAllowances({ accessPlan: "pro", allowances: { apiUnitsPerMonth: 12345, apiRatePerMinute: 30 } })).toEqual({ unitsPerMonth: 12345, ratePerMinute: 30 });
    expect(apiAllowances({ accessPlan: "pro", allowances: {} })).toEqual({ unitsPerMonth: API_UNITS_PER_MONTH.pro, ratePerMinute: 60 });
    expect(apiAllowances({ accessPlan: "starter", allowances: {} }).unitsPerMonth).toBe(0);
    expect(apiAllowances({ accessPlan: null, allowances: null })).toEqual({ unitsPerMonth: 0, ratePerMinute: 60 });
  });
  it("resets on the first of next month (UTC)", () => {
    expect(monthResetsAt(new Date("2026-09-30T23:59:59Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(monthResetsAt(new Date("2026-12-05T00:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("registry", () => {
  it("registers every read resource once, with unique names that never collide with the CRM's", () => {
    const seen: string[] = [];
    const names = registerReadResources((name, router, fragment) => {
      seen.push(name);
      expect(typeof router).toBe("function");
      expect(Object.keys(fragment.paths).length).toBeGreaterThan(0);
      for (const path of Object.keys(fragment.paths)) expect(path.startsWith(`/${name}`)).toBe(true);
      expect(fragment.components?.schemas?.Error).toBeDefined();
    });
    expect(names).toEqual(seen);
    expect(new Set(names).size).toBe(READ_RESOURCES.length);
    for (const crm of ["customers", "projects", "estimates", "invoices", "payments", "ping"]) expect(names).not.toContain(crm);
    expect(names).toEqual(["account", "locations", "reviews", "insights", "photos", "gbp-posts", "social-posts", "site-scans", "citations"]);
  });
  it("only ever documents GET operations (reads)", () => {
    for (const r of READ_RESOURCES) {
      for (const ops of Object.values(r.openapi.paths) as Record<string, unknown>[]) {
        expect(Object.keys(ops)).toEqual(["get"]);
      }
    }
  });
});
