/**
 * Quick Bid — per-sqft pricing math + the POST /api/crm/quick-bid endpoint.
 *
 * Pure math is tested in-process (quickBidLine / inferSqftMetric). The
 * endpoint tests pin the running dev server (dev-bypass session, throwaway
 * customer/SKUs/measurements, own pg pool for cleanup) and cover the honest
 * refusals: no ready measurement → 409, wrong metric → 409, no rate → 409 —
 * then the happy path, where the LATEST ready report supplies the sqft and
 * the waste factor lands on the quantity, cents-exact.
 */
import { describe, it, expect } from "vitest";
import pg from "pg";
import { inferSqftMetric, quickBidLine } from "./quickbid-math";

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

describe("quickBidLine (pure math)", () => {
  it("rate × sqft, cents-exact", () => {
    expect(quickBidLine({ rateCentsPerSqft: 1800, sqftMilli: 2_000_000, wasteBps: null }))
      .toEqual({ quantityMilli: 2_000_000, lineTotalCents: 3_600_000 });
  });

  it("waste multiplies the QUANTITY, never the rate", () => {
    expect(quickBidLine({ rateCentsPerSqft: 1800, sqftMilli: 2_000_000, wasteBps: 1000 }))
      .toEqual({ quantityMilli: 2_200_000, lineTotalCents: 3_960_000 });
  });

  it("fractional sqft + fractional waste round to whole cents", () => {
    // 2,210.5 sq ft @ $4.55/sq ft, 12% waste:
    // qty = 2_210_500 * 1.12 = 2_475_760 milli; 455 * 2_475_760 / 1000 = 1_126_470.8 → 1_126_471
    expect(quickBidLine({ rateCentsPerSqft: 455, sqftMilli: 2_210_500, wasteBps: 1200 }))
      .toEqual({ quantityMilli: 2_475_760, lineTotalCents: 1_126_471 });
  });

  it("zero waste behaves exactly like no waste", () => {
    expect(quickBidLine({ rateCentsPerSqft: 800, sqftMilli: 2_874_500, wasteBps: 0 }))
      .toEqual(quickBidLine({ rateCentsPerSqft: 800, sqftMilli: 2_874_500, wasteBps: null }));
  });
});

describe("inferSqftMetric", () => {
  it("roof-flavoured names price roof area, everything else siding", () => {
    expect(inferSqftMetric("Standard Package - Re Roof")).toBe("roof");
    expect(inferSqftMetric("Standing Seam Metal roof")).toBe("roof");
    expect(inferSqftMetric("Siding Remodel - Color +")).toBe("siding");
    expect(inferSqftMetric("Exterior Painting")).toBe("siding");
  });
});

describe("POST /api/crm/quick-bid (dev server)", () => {
  it("honest 409s, then a correct bid from the latest ready measurement", async () => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL });
    const run = Date.now().toString(36);
    let customerId: string | null = null;
    let estimateId: string | null = null;
    const itemIds: string[] = [];
    const measurementIds: string[] = [];
    try {
      const me = await api("/api/crm/me");
      if (me.status !== 200) throw new Error(`dev server not reachable at ${BASE}`);
      const cookie = me.cookie;

      const cust = await api("/api/crm/customers", {
        method: "POST",
        body: JSON.stringify({ displayName: `Vitest QB ${run}`, email: `vitest-qb-${run}@example.com` }),
      }, cookie);
      expect(cust.status).toBe(201);
      customerId = cust.body.id;

      const mkItem = async (body: any) => {
        const r = await api("/api/crm/pricebook/items", { method: "POST", body: JSON.stringify(body) }, cookie);
        expect(r.status).toBe(201);
        itemIds.push(r.body.id);
        return r.body;
      };
      const siding = await mkItem({
        name: `Vitest QB Siding ${run}`, pricingMode: "per_sqft",
        rateCentsPerSqft: 455, sqftMetric: "siding",
      });
      const roofNoRate = await mkItem({
        name: `Vitest QB Roof ${run}`, pricingMode: "per_sqft", sqftMetric: "roof",
      });

      // 1) No measurement at all → 409.
      const noMeas = await api("/api/crm/quick-bid", {
        method: "POST", body: JSON.stringify({ customerId, itemIds: [siding.id] }),
      }, cookie);
      expect(noMeas.status).toBe(409);
      expect(String(noMeas.body.message)).toMatch(/measurement/i);

      // 2) A roof-only report: a siding SKU can't price from it → 409 wrong metric.
      const m1 = await api("/api/crm/measurements", {
        method: "POST",
        body: JSON.stringify({ customerId, roofAreaSf: 2000, wasteSuggestionBps: 1000 }),
      }, cookie);
      expect(m1.status).toBe(201);
      measurementIds.push(m1.body.id);
      const wrongMetric = await api("/api/crm/quick-bid", {
        method: "POST", body: JSON.stringify({ customerId, itemIds: [siding.id] }),
      }, cookie);
      expect(wrongMetric.status).toBe(409);
      expect(String(wrongMetric.body.message)).toMatch(/siding/i);

      // 3) A newer report WITH siding area: the LATEST ready report wins.
      const m2 = await api("/api/crm/measurements", {
        method: "POST",
        body: JSON.stringify({
          customerId, provider: "hover", wallAreaSf: 2210, wasteSuggestionBps: 1200,
          addressLine1: "1 Test Way",
        }),
      }, cookie);
      expect(m2.status).toBe(201);
      measurementIds.push(m2.body.id);

      // 4) per_sqft SKU without a rate → 409, told to set the rate first.
      const noRate = await api("/api/crm/quick-bid", {
        method: "POST", body: JSON.stringify({ customerId, itemIds: [roofNoRate.id] }),
      }, cookie);
      expect(noRate.status).toBe(409);
      expect(String(noRate.body.message)).toMatch(/rate/i);

      // 5) Happy path: qty = 2,210 sq ft + 12% waste = 2,475.2 sq ft @ $4.55.
      const ok = await api("/api/crm/quick-bid", {
        method: "POST", body: JSON.stringify({ customerId, itemIds: [siding.id] }),
      }, cookie);
      expect(ok.status).toBe(201);
      estimateId = ok.body.estimate.id;
      expect(ok.body.measurement.id).toBe(m2.body.id);
      expect(ok.body.items).toHaveLength(1);
      const line = ok.body.items[0];
      expect(line.quantityMilli).toBe(2_475_200);
      expect(line.unitPriceCents).toBe(455);
      expect(line.unit).toBe("sf");
      expect(String(line.description)).toContain("hover");
      const lineCents = Math.round((455 * 2_475_200) / 1000);
      const taxBps = ok.body.estimate.taxRateBps ?? 0;
      expect(ok.body.estimate.subtotalCents).toBe(lineCents);
      expect(ok.body.estimate.totalCents)
        .toBe(lineCents + Math.round((lineCents * taxBps) / 10000));
      expect(ok.body.estimate.status).toBe("draft");

      // The row in the DB agrees with the response, to the cent.
      const { rows } = await pool.query(
        `select subtotal_cents, tax_cents, total_cents, tax_rate_bps from crm_estimates where id = $1`,
        [estimateId],
      );
      expect(rows[0].subtotal_cents).toBe(lineCents);
      expect(rows[0].total_cents).toBe(ok.body.estimate.totalCents);
      expect(rows[0].tax_rate_bps).toBe(taxBps);
    } finally {
      // The customer hard-delete takes the whole tree (estimate + items +
      // events); measurements and price book rows go by hand.
      if (customerId) {
        await api(`/api/crm/customers/${customerId}?force=1`, { method: "DELETE" }).catch(() => {});
        await pool.query(`delete from crm_measurements where customer_id = $1`, [customerId]).catch(() => {});
        await pool.query(`delete from crm_estimates where customer_id = $1`, [customerId]).catch(() => {});
      }
      for (const id of itemIds) {
        await pool.query(`delete from crm_pb_items where id = $1`, [id]).catch(() => {});
      }
      await pool.end().catch(() => {});
    }
  });
});
