/**
 * GET /api/crm/tax/estimate-rate and the estimate-create tax hook (server/crm/tax.ts), in-process on the
 * lane Postgres (constructhub_dev[_x] on localhost only) with a throwaway user/org deleted afterwards.
 * The official WA DOR table is the bundled server/data/sales-tax-rates.json (seeded like boot does).
 */
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

vi.mock("../email", () => ({ sendWithFallback: vi.fn(async () => ({ accepted: ["fixture@example.invalid"] })) }));
// No live WA DOR calls in tests: off by default, stubbed in the one test that exercises it.
process.env.WA_DOR_ADDRESS_LOOKUP = "off";

const lane = (() => {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return /^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(u.pathname) && ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch { return false; }
})();

describe.skipIf(!lane)("estimate tax from the job-site address (lane Postgres)", () => {
  let pool: typeof import("../db").pool;
  let base = "", server: ReturnType<express.Express["listen"]>;
  let userId = 0, otherUserId = 0, orgId = "";
  let waRate: Record<string, number> = {};

  async function call(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", as = userId) {
    const r = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", "x-fixture-user": String(as) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  }
  const client = async (addr: Record<string, string | null>) => {
    const c = await call("/api/crm/customers", { displayName: `Tax ${randomUUID().slice(0, 8)}`, email: `tax-${randomUUID()}@example.invalid`, ...addr });
    expect(c.status).toBe(201);
    return c.data.id as string;
  };
  const rate = (customerId: string, projectId?: string) =>
    call(`/api/crm/tax/estimate-rate?customerId=${customerId}${projectId ? `&projectId=${projectId}` : ""}`);
  const taxSourceOf = async (estimateId: string) => {
    for (let i = 0; i < 20; i++) { // stamped just after the response
      const ts = (await pool.query("SELECT custom_fields->'taxSource' AS t, tax_rate_bps FROM crm_estimates WHERE id=$1", [estimateId])).rows[0];
      if (ts?.t) return ts;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };

  beforeAll(async () => {
    ({ pool } = await import("../db"));
    await (await import("./schema-ensure")).ensureCrmSchema();
    await (await import("../sales-tax/store")).seedSalesTaxRates(pool, join(import.meta.dirname, "..", "data"));
    for (const r of (await pool.query("SELECT city, rate_bps FROM sales_tax_rates WHERE state='WA' AND city IN ('Bellingham','Ferndale')")).rows) waRate[r.city] = r.rate_bps;
    userId = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`i-tax-${randomUUID()}@example.invalid`])).rows[0].id;
    otherUserId = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`i-tax2-${randomUUID()}@example.invalid`])).rows[0].id;
    await pool.query("INSERT INTO crm_subscriptions(user_id,plan,status) VALUES($1,'crm_essentials','active'),($2,'crm_essentials','active')", [userId, otherUserId]);
    const { registerCrmRoutes } = await import("./routes");
    const app = express();
    app.set("trust proxy", true);
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: Number(req.headers["x-fixture-user"]) }; req.session = {}; next(); });
    registerCrmRoutes(app, (req: any) => req.user);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await call("/api/crm/me")).status).toBe(200);
    orgId = (await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id=$1", [userId])).rows[0].id;
    await pool.query("UPDATE crm_orgs SET default_tax_rate_bps=650, state='WA' WHERE id=$1", [orgId]);
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    const orgIds = (await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id = ANY($1::int[])", [[userId, otherUserId]])).rows.map((r) => r.id);
    for (const id of orgIds) {
      const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.columns
         WHERE table_schema='public' AND column_name='org_id' AND table_name LIKE 'crm\\_%' AND table_name <> 'crm_orgs'`);
      for (const { table_name } of rows) await pool.query(`DELETE FROM ${table_name} WHERE org_id=$1`, [id]).catch(() => {});
      await pool.query("DELETE FROM crm_orgs WHERE id=$1", [id]);
    }
    await pool.query("DELETE FROM crm_subscriptions WHERE user_id = ANY($1::int[])", [[userId, otherUserId]]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [[userId, otherUserId]]);
  });

  it("the bundled WA DOR table is loaded (Bellingham, Ferndale)", () => {
    expect(waRate.Bellingham).toBeGreaterThan(650);
    expect(waRate.Ferndale).toBeGreaterThan(650);
  });

  it("a Bellingham client gets the WA DOR Bellingham rate and the source line", async () => {
    const id = await client({ addressLine1: "1 Holly St", city: "Bellingham", state: "WA", postalCode: "98225" });
    const r = await rate(id);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ bps: waRate.Bellingham, source: "official", city: "Bellingham", state: "WA" });
    expect(r.data.label).toMatch(/^Bellingham, WA · [\d.]+% \(WA DOR, Q\d 20\d\d\)$/);
  });

  it("the state comes from the ZIP when the address has none; city case doesn't matter", async () => {
    const id = await client({ addressLine1: "2 Main St", city: "ferndale", state: null, postalCode: "98248" });
    expect((await rate(id)).data).toMatchObject({ bps: waRate.Ferndale, source: "official", state: "WA" });
  });

  it("a project's site address wins over the client's", async () => {
    const id = await client({ addressLine1: "3 Elm", city: "Ferndale", state: "WA" });
    const p = await call("/api/crm/projects", { customerId: id, name: "Site job", addressLine1: "9 Bay St", city: "Bellingham", state: "WA" });
    expect(p.status).toBe(201);
    expect((await rate(id, p.data.id)).data).toMatchObject({ bps: waRate.Bellingham, city: "Bellingham" });
  });

  it("Florida: 0 with the FL DOR line, even with an org default", async () => {
    const id = await client({ addressLine1: "4 Bay", city: "Tampa", state: "FL" });
    const r = await rate(id);
    expect(r.data).toMatchObject({ bps: 0, source: "construction-exempt", state: "FL" });
    expect(r.data.label).toMatch(/^Florida: .+ — FL DOR /);
  });

  it("unknown city / no city → the org default, and the line says why", async () => {
    const a = await client({ addressLine1: "5 Nowhere", city: "Atlantisville", state: "WA" });
    expect((await rate(a)).data).toMatchObject({ bps: 650, source: "org", fallbackReason: "no_match" });
    expect((await rate(a)).data.label).toBe("No rate found for Atlantisville, WA — using your default (6.5%)");
    const b = await client({ addressLine1: "6 No City Rd", city: null, state: "WA" });
    expect((await rate(b)).data).toMatchObject({ bps: 650, source: "org", fallbackReason: "no_city" });
  });

  it("WA: the street address is placed by WA DOR (Forrest Hild: Blaine mailing address → Whatcom PTBA 3737, 8.9%)", async () => {
    const { clearWaAddressCache } = await import("../sales-tax/wa-address");
    clearWaAddressCache();
    const realFetch = globalThis.fetch;
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: any, init?: any) => {
      const u = String(url);
      if (!u.startsWith("https://webgis.dor.wa.gov/")) return realFetch(url, init);
      asked.push(u);
      if (u.includes("Broken")) return new Response("busy", { status: 503 });
      return new Response(`<?xml version="1.0" encoding="utf-8"?><response loccode="3737" localrate=".024" rate=".089" code="2"><addressline code="3737" period="Q42026" /></response>`);
    });
    process.env.WA_DOR_ADDRESS_LOOKUP = "on";
    try {
      const id = await client({ addressLine1: "4783 Bayshore Drive", city: "Blaine", state: "WA", postalCode: "98230" });
      const r = await rate(id);
      expect(r.data).toMatchObject({ bps: 890, source: "official", city: "Blaine", state: "WA" });
      expect(r.data.label).toBe("Blaine, WA — Whatcom County Unincorp. PTBA · 8.9% (WA DOR, Q4 2026)");
      expect(asked[0]).toContain("addr=4783+Bayshore+Drive");
      expect(asked[0]).toContain("zip=98230");
      // DOR down → the city table, never an error.
      const down = await client({ addressLine1: "1 Broken Rd", city: "Ferndale", state: "WA", postalCode: "98248" });
      expect((await rate(down)).data).toMatchObject({ bps: waRate.Ferndale, source: "official", city: "Ferndale" });
    } finally {
      process.env.WA_DOR_ADDRESS_LOOKUP = "off";
      vi.unstubAllGlobals();
    }
  });

  it("phase-2 tables: a city in another state, and Hawaii's one county rate for any town", async () => {
    const { lookupOfficialRate } = await import("../sales-tax/store");
    expect((await lookupOfficialRate(pool, { state: "CA", city: "Los Angeles" })).match).toMatchObject({ ratePct: 10.25, source: expect.any(String) });
    expect((await lookupOfficialRate(pool, { state: "HI", city: "Hilo" })).match).toMatchObject({ ratePct: 4.5, kind: "state" });
    expect(await lookupOfficialRate(pool, { state: "CO", city: "Denver" })).toEqual({ loaded: false, match: null });
  });

  it("another org's client is not found; customerId is required", async () => {
    const id = await client({ addressLine1: "7 Holly", city: "Bellingham", state: "WA" });
    expect((await call("/api/crm/me", undefined, "GET", otherUserId)).status).toBe(200);
    expect((await call(`/api/crm/tax/estimate-rate?customerId=${id}`, undefined, "GET", otherUserId)).status).toBe(404);
    expect((await call("/api/crm/tax/estimate-rate")).status).toBe(400);
  });

  it("an estimate created without a rate gets the city rate, and taxSource records city + source", async () => {
    const id = await client({ addressLine1: "8 Holly", city: "Bellingham", state: "WA" });
    const e = await call("/api/crm/estimates", { customerId: id, title: "Hook", items: [{ name: "Work", unitPriceCents: 10000 }] });
    expect(e.status).toBe(201);
    const ts = await taxSourceOf(e.data.id);
    expect(ts.tax_rate_bps).toBe(waRate.Bellingham);
    expect(ts.t).toMatchObject({ source: "official", city: "Bellingham", state: "WA", official: { source: "WA DOR" }, treatment: { treatment: "taxable" } });
  });

  it("an explicit rate always wins; a changed one is logged as manual with the suggestion", async () => {
    const id = await client({ addressLine1: "9 Holly", city: "Bellingham", state: "WA" });
    const same = await call("/api/crm/estimates", { customerId: id, title: "Same", taxRateBps: waRate.Bellingham, items: [{ name: "W", unitPriceCents: 100 }] });
    expect((await taxSourceOf(same.data.id)).t).toMatchObject({ source: "official", bps: waRate.Bellingham });
    const manual = await call("/api/crm/estimates", { customerId: id, title: "Manual", taxRateBps: 0, items: [{ name: "W", unitPriceCents: 100 }] });
    const ts = await taxSourceOf(manual.data.id);
    expect(ts.tax_rate_bps).toBe(0);
    expect(ts.t).toMatchObject({ source: "manual", bps: 0, suggested: { source: "official", bps: waRate.Bellingham } });
  });
});
