/**
 * GET /api/mail-alerts (server/mail-alerts/routes.ts) category/severity filters: a typed value equal to a
 * stored one matches by equality, an unknown value matches nothing (200 with an empty page, not an error),
 * a value over 40 characters is a 400, an empty string is "no filter", and the value only ever reaches
 * Postgres as a bound parameter — never spliced into the query text.
 *
 * The pool is mocked: the fake applies the `($n='' OR m.col=$n)` equality clauses to an in-memory fixture
 * so the route's parameter wiring is what gets exercised. `q` (search) behaviour is deliberately not
 * asserted here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));
vi.mock("../db", () => ({ pool: { query: mocks.query }, db: {} }));
vi.mock("../growth-limits", () => ({
  rateLimit: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("./gmail", () => ({
  requireMailModule: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("./service", () => ({ forwardingAddress: async () => "alerts@example.test" }));

import { registerMailAlertRoutes } from "./routes";

const USER = 7;
type Row = { id: number; category: string; severity: string; subject: string; sender: string; location_id: number | null; read_at: null };
const STORED: Row[] = [
  { id: 1, category: "gbp", severity: "critical", subject: "Profile suspended", sender: "mybusiness-noreply@google.com", location_id: null, read_at: null },
  { id: 2, category: "registrar", severity: "warning", subject: "Domain expiry notice", sender: "noreply@porkbun.com", location_id: null, read_at: null },
  { id: 3, category: "cloudflare", severity: "info", subject: "Member invitation", sender: "noreply@notify.cloudflare.com", location_id: null, read_at: null },
];

/** The fake Postgres: evaluates the route's category ($3) / severity ($4) equality clauses on the fixture. */
function fakeQuery(text: string, params: unknown[] = []) {
  const eq = (col: "category" | "severity", v: unknown) => (r: Row) => v === "" || r[col] === v;
  if (/^SELECT count\(\*\) FILTER/.test(text)) {
    return { rows: [{ unread: STORED.length, critical: 1, unmapped: STORED.length }], rowCount: 1 };
  }
  const [, , category, severity] = params;
  const matched = STORED.filter(eq("category", category)).filter(eq("severity", severity));
  if (/^SELECT count\(\*\)::int total/.test(text)) return { rows: [{ total: matched.length }], rowCount: 1 };
  return { rows: matched, rowCount: matched.length };
}

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerMailAlertRoutes(app, () => ({ id: USER }));
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => {
  mocks.query.mockReset();
  mocks.query.mockImplementation(async (text: string, params?: unknown[]) => fakeQuery(text, params));
});

const list = async (qs: Record<string, string>) => {
  const res = await fetch(`${base}/api/mail-alerts?${new URLSearchParams(qs)}`);
  return { status: res.status, body: await res.json() };
};
/** Every pool.query call that carried the list filter (the page and the total), as [text, params]. */
const filterCalls = () =>
  mocks.query.mock.calls.filter(([text]) => /FROM mail_alert_messages m/.test(String(text))) as [string, unknown[]][];

describe("GET /api/mail-alerts category and severity filters", () => {
  it("a typed category equal to a stored one matches exactly that alert", async () => {
    const { status, body } = await list({ category: "registrar" });
    expect(status).toBe(200);
    expect(body.items.map((r: Row) => r.id)).toEqual([2]);
    expect(body.total).toBe(1);
    for (const [, params] of filterCalls()) expect(params[2]).toBe("registrar");
  });

  it("a typed severity equal to a stored one matches exactly that alert", async () => {
    const { status, body } = await list({ severity: "critical" });
    expect(status).toBe(200);
    expect(body.items.map((r: Row) => r.id)).toEqual([1]);
    expect(body.total).toBe(1);
    for (const [, params] of filterCalls()) expect(params[3]).toBe("critical");
  });

  it("category and severity combine (both must match)", async () => {
    expect((await list({ category: "gbp", severity: "critical" })).body.items.map((r: Row) => r.id)).toEqual([1]);
    expect((await list({ category: "gbp", severity: "info" })).body.items).toEqual([]);
  });

  it("an unknown value matches nothing and is not an error", async () => {
    for (const qs of [{ category: "not-a-category" }, { severity: "fatal" }, { category: "GBP" }]) {
      const { status, body } = await list(qs);
      expect(status, JSON.stringify(qs)).toBe(200);
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
    }
  });

  it("41 characters is a 400 and never reaches the pool; 40 is accepted", async () => {
    for (const key of ["category", "severity"] as const) {
      mocks.query.mockClear();
      const { status, body } = await list({ [key]: "x".repeat(41) });
      expect(status, key).toBe(400);
      expect(body).toEqual({ message: "Invalid mail alert input" });
      expect(mocks.query).not.toHaveBeenCalled();
      expect((await list({ [key]: "x".repeat(40) })).status, key).toBe(200);
    }
  });

  it("an empty string (or an absent key) is no filter at all", async () => {
    for (const qs of [{}, { category: "" }, { severity: "" }, { category: "", severity: "" }]) {
      const { status, body } = await list(qs);
      expect(status, JSON.stringify(qs)).toBe(200);
      expect(body.items.map((r: Row) => r.id)).toEqual([1, 2, 3]);
      expect(body.total).toBe(3);
      for (const [, params] of filterCalls()) {
        expect(params[2]).toBe("");
        expect(params[3]).toBe("");
      }
    }
  });

  it("values reach SQL only as bound parameters, never interpolated into the query text", async () => {
    const category = "gbp' OR 1=1 --";
    const severity = "crit\"; DROP TABLE mail_alerts; --";
    const { status, body } = await list({ category, severity });
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
    const calls = filterCalls();
    expect(calls.length).toBe(2);
    for (const [text, params] of calls) {
      expect(text).not.toContain(category);
      expect(text).not.toContain(severity);
      expect(text).not.toContain("DROP TABLE");
      expect(text).not.toContain("1=1");
      // The filter is the parameterised equality form, with the value only in the params array.
      expect(text).toContain("($3='' OR m.category=$3)");
      expect(text).toContain("($4='' OR m.severity=$4)");
      expect(params[2]).toBe(category);
      expect(params[3]).toBe(severity);
    }
  });

  it("the page-wide counts query never carries the typed filter values", async () => {
    await list({ category: "registrar", severity: "warning" });
    const counts = mocks.query.mock.calls.find(([text]) => /count\(\*\) FILTER/.test(String(text)))!;
    expect(counts).toBeDefined();
    expect(counts[1]).toEqual([USER]);
    expect(counts[0]).not.toContain("registrar");
  });
});

describe("GET /api/mail-alerts search escapes LIKE wildcards (review w3-r2 L3)", () => {
  const qParam = () => { const calls = filterCalls(); expect(calls.length).toBe(2); return calls.map(([, params]) => params[1]); };

  it("`%` and `_` are literal characters in the pattern, not wildcards", async () => {
    expect((await list({ q: "%" })).status).toBe(200);
    for (const p of qParam()) expect(p).toBe("%\\%%");
    mocks.query.mockClear();
    await list({ q: "50%_off" });
    for (const p of qParam()) expect(p).toBe("%50\\%\\_off%");
  });

  it("a backslash is escaped too, so it cannot escape the closing wildcard", async () => {
    await list({ q: "a\\" });
    for (const p of qParam()) expect(p).toBe("%a\\\\%");
  });

  it("ordinary text is unchanged inside the wildcards", async () => {
    await list({ q: "Profile suspended" });
    for (const p of qParam()) expect(p).toBe("%Profile suspended%");
  });
});
