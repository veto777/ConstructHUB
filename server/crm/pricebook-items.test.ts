/**
 * Price book item PATCH/DELETE — the write side of the Price Chart tab.
 *
 * Pinned here against a running dev server (dev-bypass session, throwaway
 * rows, own pg pool):
 *   - PATCH updates only the sent fields, returns the updated row, validates
 *     formulas before they can poison an estimate, and 404s a bogus id.
 *   - DELETE is a soft delete: the row leaves the active list but stays in
 *     the table (packages/accessories reference it by id), and a second
 *     DELETE 404s.
 *
 * Local dev DB only. The throwaway row is hard-deleted in the finally block.
 */
import { describe, it, expect } from "vitest";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

describe("pricebook item PATCH/DELETE (dev server)", () => {
  it("create → patch → delete lifecycle, validated and org-scoped", async () => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL });
    const run = Date.now().toString(36);
    let id: string | null = null;
    try {
      const me = await api("/api/crm/me");
      if (me.status !== 200) throw new Error(`dev server not reachable at ${BASE}`);
      const cookie = me.cookie;

      // Create a throwaway flat-priced SKU.
      const created = await api("/api/crm/pricebook/items", {
        method: "POST",
        body: JSON.stringify({
          name: `Vitest SKU ${run}`, code: `VT-${run}`, unit: "sq",
          pricingMode: "flat", flatPriceCents: 123_45, flatCostCents: 80_00,
        }),
      }, cookie);
      expect(created.status).toBe(201);
      id = created.body.id;

      // PATCH touches only the sent fields; the rest survive.
      const patched = await api(`/api/crm/pricebook/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: `Vitest SKU ${run} v2`, flatPriceCents: 222_22 }),
      }, cookie);
      expect(patched.status).toBe(200);
      expect(patched.body.name).toBe(`Vitest SKU ${run} v2`);
      expect(patched.body.flatPriceCents).toBe(222_22);
      expect(patched.body.code).toBe(`VT-${run}`);
      expect(patched.body.flatCostCents).toBe(80_00);

      // A bad formula is rejected before it can poison an estimate.
      const badFormula = await api(`/api/crm/pricebook/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ pricingMode: "formula", qtyFormula: "[SQUARES] + *" }),
      }, cookie);
      expect(badFormula.status).toBe(400);

      // A wrong-typed field is a 400, a bogus id a 404.
      const badType = await api(`/api/crm/pricebook/items/${id}`, {
        method: "PATCH", body: JSON.stringify({ flatPriceCents: "lots" }),
      }, cookie);
      expect(badType.status).toBe(400);
      const missing = await api("/api/crm/pricebook/items/not-a-real-id", {
        method: "PATCH", body: JSON.stringify({ name: "ghost" }),
      }, cookie);
      expect(missing.status).toBe(404);

      // DELETE: gone from the active list, row parked inactive, second
      // delete 404s.
      const del = await api(`/api/crm/pricebook/items/${id}`, { method: "DELETE" }, cookie);
      expect(del.status).toBe(200);
      const list = await api("/api/crm/pricebook/items", {}, cookie);
      expect(list.status).toBe(200);
      expect((list.body as any[]).some((i) => i.id === id)).toBe(false);
      const { rows } = await pool.query(`select active from crm_pb_items where id = $1`, [id]);
      expect(rows[0]?.active).toBe(false);
      const delAgain = await api(`/api/crm/pricebook/items/${id}`, { method: "DELETE" }, cookie);
      expect(delAgain.status).toBe(404);
    } finally {
      if (id) await pool.query(`delete from crm_pb_items where id = $1`, [id]).catch(() => {});
      await pool.end().catch(() => {});
    }
  });

  // API only (no SQL): everything it makes is soft-deleted through the app.
  it("guards codes, formula symbols and blank names; edits and soft-deletes labor and materials", async () => {
    const run = Date.now().toString(36);
    const me = await api("/api/crm/me");
    if (me.status !== 200) throw new Error(`dev server not reachable at ${BASE}`);
    const cookie = me.cookie;
    const post = (path: string, body: any) => api(path, { method: "POST", body: JSON.stringify(body) }, cookie);
    const items: string[] = [];
    try {
      // A typed code is unique among the org's active SKUs, case-insensitively.
      const a = await post("/api/crm/pricebook/items", {
        name: `Vitest code ${run}`, code: `VTC-${run}`, pricingMode: "flat", flatPriceCents: 100,
      });
      expect(a.status).toBe(201);
      items.push(a.body.id);
      const dupe = await post("/api/crm/pricebook/items", {
        name: `Vitest code dupe ${run}`, code: `vtc-${run}`, pricingMode: "flat", flatPriceCents: 100,
      });
      expect(dupe.status).toBe(409);
      expect(dupe.body.message).toMatch(/already used/);
      // Re-saving a SKU with its own code is fine.
      const keep = await api(`/api/crm/pricebook/items/${a.body.id}`, {
        method: "PATCH", body: JSON.stringify({ code: `VTC-${run}`, flatPriceCents: 150 }),
      }, cookie);
      expect(keep.status).toBe(200);

      // A spaces-only name is not a name.
      expect((await post("/api/crm/pricebook/items", { name: "   ", pricingMode: "flat", flatPriceCents: 1 })).status).toBe(400);

      // A typo'd symbol would evaluate to 0 — refused on save; a declared placeholder is fine.
      const typo = await post("/api/crm/pricebook/items", {
        name: `Vitest typo ${run}`, pricingMode: "formula", qtyFormula: "[SQAURES] * 2",
      });
      expect(typo.status).toBe(400);
      expect(typo.body.message).toMatch(/Unknown symbol \[SQAURES\]/);
      const ph = await post("/api/crm/pricebook/items", {
        name: `Vitest placeholder ${run}`, pricingMode: "formula", qtyFormula: "[BAYS] * 2",
        placeholders: [{ symbol: "bays", label: "Garage bays" }],
      });
      expect(ph.status).toBe(201);
      items.push(ph.body.id);
      // The tester warns instead of refusing (it can't know a SKU's placeholders).
      const t = await post("/api/crm/pricebook/formula/test", { formula: "[FOO] * 2", symbols: {} });
      expect(t.status).toBe(200);
      expect(t.body.warnings?.[0]).toMatch(/Unknown symbol \[FOO\]/);

      // Labor rates: PATCH + soft DELETE.
      const lab = await post("/api/crm/pricebook/labor-rates", {
        name: `Vitest crew ${run}`, hourlyCostCents: 4000, hourlyPriceCents: 8000,
      });
      expect(lab.status).toBe(201);
      const labPatch = await api(`/api/crm/pricebook/labor-rates/${lab.body.id}`, {
        method: "PATCH", body: JSON.stringify({ hourlyPriceCents: 9000 }),
      }, cookie);
      expect(labPatch.status).toBe(200);
      expect(labPatch.body.hourlyPriceCents).toBe(9000);
      expect(labPatch.body.hourlyCostCents).toBe(4000);
      expect((await api(`/api/crm/pricebook/labor-rates/${lab.body.id}`, { method: "DELETE" }, cookie)).status).toBe(200);
      expect((await api(`/api/crm/pricebook/labor-rates/${lab.body.id}`, { method: "DELETE" }, cookie)).status).toBe(404);
      const labs = await api("/api/crm/pricebook/labor-rates", {}, cookie);
      expect((labs.body as any[]).some((l) => l.id === lab.body.id)).toBe(false);

      // Materials: soft DELETE leaves the active list.
      const mat = await post("/api/crm/pricebook/materials", { name: `Vitest mat ${run}`, unit: "sq" });
      expect(mat.status).toBe(201);
      expect((await api(`/api/crm/pricebook/materials/${mat.body.id}`, { method: "DELETE" }, cookie)).status).toBe(200);
      const mats = await api("/api/crm/pricebook/materials", {}, cookie);
      expect((mats.body as any[]).some((m) => m.id === mat.body.id)).toBe(false);
    } finally {
      for (const id of items) await api(`/api/crm/pricebook/items/${id}`, { method: "DELETE" }, cookie).catch(() => {});
    }
  });
});
