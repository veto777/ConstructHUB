/**
 * Price-floor lock — reps can price ABOVE the floor, never below it.
 *
 * Pure part: floor resolution (SKU price / cost / cost+margin) and the
 * tolerant settings reader. Server part (dev server): lock OFF → below-floor
 * allowed; lock ON + non-owner → 422 below floor, 200 at/above; owner exempt;
 * a discount set that undercuts the floor-total → 422; the floorBps
 * cost-margin variant floors at cost × (1 + bps), not the SKU price.
 *
 * Uses the divisions.test.ts trick: the dev-bypass user's membership is
 * re-roled via SQL, exercised, and restored in a finally block. Throwaway
 * rows only; the lock setting and the role are ALWAYS restored.
 *
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8159 npx tsx --env-file=.env server/index.ts
 *   CRM_TEST_BASE_URL=http://127.0.0.1:8159 DATABASE_URL=… npx vitest run server/crm/price-floor.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

let priceFloorLockOf: any, floorCentsForLine: any, belowFloorLine: any, priceLockMessage: any, floorTotalCents: any;

beforeAll(async () => {
  ({ priceFloorLockOf, floorCentsForLine, belowFloorLine, priceLockMessage, floorTotalCents } =
    await import("./price-floor"));
});

// ── Pure: settings reader ───────────────────────────────────────────────────

describe("priceFloorLockOf (pure)", () => {
  it("defaults to OFF when nothing (or junk) is stored", () => {
    expect(priceFloorLockOf(null)).toEqual({ enabled: false });
    expect(priceFloorLockOf({})).toEqual({ enabled: false });
    expect(priceFloorLockOf("junk")).toEqual({ enabled: false });
    expect(priceFloorLockOf({ priceFloorLock: "junk" })).toEqual({ enabled: false });
    expect(priceFloorLockOf({ priceFloorLock: {} })).toEqual({ enabled: false });
  });

  it("reads enabled and a valid floorBps; drops an out-of-range one", () => {
    expect(priceFloorLockOf({ priceFloorLock: { enabled: true } })).toEqual({ enabled: true });
    expect(priceFloorLockOf({ priceFloorLock: { enabled: true, floorBps: 3000 } }))
      .toEqual({ enabled: true, floorBps: 3000 });
    expect(priceFloorLockOf({ priceFloorLock: { enabled: true, floorBps: 99_999 } }))
      .toEqual({ enabled: true });
  });
});

// ── Pure: floor resolution ──────────────────────────────────────────────────

const index = {
  byName: new Map([
    ["labor", { priceCents: 450, costCents: 300 }],
    ["shingles", { priceCents: 18500, costCents: 11500 }],
  ]),
  bySku: new Map([["shg-arch", { priceCents: 18500, costCents: 11500 }]]),
};

describe("floorCentsForLine (pure)", () => {
  it("a SKU-matched line floors at the SKU's current price", () => {
    expect(floorCentsForLine({ name: "Labor", unitPriceCents: 0 }, index, { enabled: true })).toBe(450);
    // Exact-name match is case-insensitive and trimmed.
    expect(floorCentsForLine({ name: "  labor ", unitPriceCents: 0 }, index, { enabled: true })).toBe(450);
    // A SKU token at the start of the description matches too.
    expect(floorCentsForLine(
      { name: "Architectural shingles", description: "SHG-ARCH · 30yr", unitPriceCents: 0 },
      index, { enabled: true },
    )).toBe(18500);
  });

  it("floorBps floors at cost × (1 + bps) INSTEAD of the SKU price when a cost exists", () => {
    // cost 300, SKU price 450, +50% margin → 450 happens to tie; use 25% → 375 ≠ 450.
    expect(floorCentsForLine({ name: "Labor", unitPriceCents: 0 }, index, { enabled: true, floorBps: 2500 })).toBe(375);
    // …and it rounds UP, never down.
    expect(floorCentsForLine({ name: "Labor", unitPriceCents: 0 }, index, { enabled: true, floorBps: 3333 }))
      .toBe(Math.ceil(300 * 1.3333));
  });

  it("a non-SKU line with a cost floors at cost; with neither, there is no floor", () => {
    expect(floorCentsForLine({ name: "Custom", unitPriceCents: 0, unitCostCents: 200 }, index, { enabled: true })).toBe(200);
    expect(floorCentsForLine({ name: "Custom", unitPriceCents: 0 }, index, { enabled: true })).toBe(0);
  });

  it("belowFloorLine skips discount lines and flags only strictly-below prices", () => {
    const lines = [
      { kind: "discount", name: "Deal", unitPriceCents: 0 },
      { name: "Labor", unitPriceCents: 450 }, // AT the floor — allowed
    ];
    expect(belowFloorLine(lines, index, { enabled: true })).toBeNull();
    const hit = belowFloorLine([{ name: "Labor", unit: "sf", unitPriceCents: 449 }], index, { enabled: true });
    expect(hit.floorCents).toBe(450);
    expect(priceLockMessage(hit.line, hit.floorCents))
      .toBe("Price lock: 'Labor' can't go below $4.50/sf — the floor set by the owner");
  });

  it("floorTotalCents scales by quantity", () => {
    expect(floorTotalCents([{ name: "Labor", unitPriceCents: 450, quantityMilli: 2000 }], index, { enabled: true }))
      .toBe(900);
  });
});

// ── Server: enforcement end to end ──────────────────────────────────────────

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

describe("price-floor lock (dev server)", () => {
  it("lock OFF allows, lock ON blocks non-owners below the floor, owner exempt, discounts capped", async () => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL });
    const run = Date.now().toString(36);
    let cookie: string | undefined;
    let priorLock: any = null;
    const estimateIds: string[] = [];
    try {
      const me = await api("/api/crm/me");
      if (me.status !== 200) throw new Error(`dev server not reachable at ${BASE}`);
      cookie = me.cookie;
      const orgId = me.body.org.id as string;
      priorLock = me.body.org.customFields?.priceFloorLock ?? null;

      // A throwaway SKU: price $5.00, cost $3.00 (so the 50%-margin floor,
      // $4.50, is distinguishable from the SKU-price floor, $5.00).
      const mat = await api("/api/crm/pricebook/materials", {
        method: "POST",
        body: JSON.stringify({ name: `Vitest FloorMat ${run}`, sku: `VFM-${run}`, unit: "sf", costCents: 300, priceCents: 500 }),
      }, cookie);
      expect(mat.status).toBe(201);

      const cust = await api("/api/crm/customers", {
        method: "POST", body: JSON.stringify({ displayName: `Vitest Floor ${run}` }),
      }, cookie);
      expect(cust.status).toBe(201);
      const customerId = cust.body.id as string;
      const line = (price: number, extra: any = {}) => ({
        kind: "material", name: `Vitest FloorMat ${run}`, unit: "sf",
        quantityMilli: 1000, unitPriceCents: price, ...extra,
      });
      const mkEstimate = (items: any[]) =>
        api("/api/crm/estimates", { method: "POST", body: JSON.stringify({ customerId, title: `Vitest floor ${run}`, items }) }, cookie);

      // ── Lock OFF: below-floor pricing is allowed for anyone. ──
      const off = await api("/api/crm/org/price-floor-lock", {
        method: "PUT", body: JSON.stringify({ enabled: false }),
      }, cookie);
      expect(off.status).toBe(200);
      expect(off.body.customFields.priceFloorLock.enabled).toBe(false);
      const belowOff = await mkEstimate([line(100)]);
      expect(belowOff.status).toBe(201);
      estimateIds.push(belowOff.body.id);

      // ── Lock ON, still the owner: the owner is EXEMPT. ──
      const on = await api("/api/crm/org/price-floor-lock", {
        method: "PUT", body: JSON.stringify({ enabled: true }),
      }, cookie);
      expect(on.status).toBe(200);
      const ownerBelow = await mkEstimate([line(100)]);
      expect(ownerBelow.status).toBe(201);
      estimateIds.push(ownerBelow.body.id);

      // ── Flip the dev user to admin — the lock now applies. ──
      await pool.query(`update crm_members set role = 'admin' where org_id = $1 and user_id = 1`, [orgId]);

      // A non-owner may not even change the lock.
      const forbidden = await api("/api/crm/org/price-floor-lock", {
        method: "PUT", body: JSON.stringify({ enabled: false }),
      }, cookie);
      expect(forbidden.status).toBe(403);

      // Below the SKU-price floor → 422 naming the item and its floor.
      const below = await mkEstimate([line(499)]);
      expect(below.status).toBe(422);
      expect(below.body.message).toContain(`'Vitest FloorMat ${run}'`);
      expect(below.body.message).toContain("$5.00/sf");

      // At the floor and above it → allowed (reps price UP freely).
      for (const price of [500, 900]) {
        const okRes = await mkEstimate([line(price)]);
        expect(okRes.status).toBe(201);
        estimateIds.push(okRes.body.id);
      }

      // The items-replace route enforces the same floor.
      const atFloor = await mkEstimate([line(500)]);
      expect(atFloor.status).toBe(201);
      estimateIds.push(atFloor.body.id);
      const edit = await api(`/api/crm/estimates/${atFloor.body.id}/items`, {
        method: "PUT", body: JSON.stringify({ items: [line(499)] }),
      }, cookie);
      expect(edit.status).toBe(422);
      expect(edit.body.message).toContain("Price lock:");

      // ── floorBps: floor at cost × 1.5 = $4.50, below the SKU price. ──
      // (Written via SQL — only the owner may use the settings route.)
      await pool.query(
        `update crm_orgs set custom_fields = jsonb_set(custom_fields, '{priceFloorLock}', $1::jsonb) where id = $2`,
        [JSON.stringify({ enabled: true, floorBps: 5000 }), orgId],
      );
      const marginOk = await mkEstimate([line(475)]); // ≥ $4.50, < $5.00 → allowed under the margin floor
      expect(marginOk.status).toBe(201);
      estimateIds.push(marginOk.body.id);
      const marginBad = await mkEstimate([line(449)]);
      expect(marginBad.status).toBe(422);
      expect(marginBad.body.message).toContain("$4.50/sf");

      // Back to the plain SKU-price floor for the discount checks.
      await pool.query(
        `update crm_orgs set custom_fields = jsonb_set(custom_fields, '{priceFloorLock}', $1::jsonb) where id = $2`,
        [JSON.stringify({ enabled: true }), orgId],
      );

      // ── Discounts may not take the total below the sum of floors. ──
      // Item at $6.00 (floor $5.00): a 5% offer → $5.70 ≥ floor → allowed.
      const roomy = await mkEstimate([line(600)]);
      expect(roomy.status).toBe(201);
      estimateIds.push(roomy.body.id);
      const okOffers = await api(`/api/crm/estimates/${roomy.body.id}/discounts`, {
        method: "PUT",
        body: JSON.stringify({ offers: [{ code: "pay_in_full", label: "Pay in full", percentBps: 500, enabled: true }] }),
      }, cookie);
      expect(okOffers.status).toBe(200);

      // Item AT the floor: ANY concession undercuts it → 422.
      const tight = await mkEstimate([line(500)]);
      expect(tight.status).toBe(201);
      estimateIds.push(tight.body.id);
      const badOffers = await api(`/api/crm/estimates/${tight.body.id}/discounts`, {
        method: "PUT",
        body: JSON.stringify({ offers: [{ code: "pay_in_full", label: "Pay in full", percentBps: 500, enabled: true }] }),
      }, cookie);
      expect(badOffers.status).toBe(422);
      expect(badOffers.body.message).toContain("Price lock:");
      expect(badOffers.body.message).toContain("$5.00");
    } finally {
      // ALWAYS restore the owner role and the prior lock setting — every
      // other suite depends on the dev user being the owner.
      await pool.query(`update crm_members set role = 'owner', division_id = null where user_id = 1`);
      const me2 = await api("/api/crm/me", {}, cookie);
      const orgId2 = me2.body?.org?.id;
      if (orgId2) {
        await api("/api/crm/org/price-floor-lock", {
          method: "PUT",
          body: JSON.stringify(priorLock && typeof priorLock === "object"
            ? { enabled: priorLock.enabled === true, floorBps: priorLock.floorBps ?? null }
            : { enabled: false }),
        }, cookie);
      }
      for (const id of estimateIds) {
        await api(`/api/crm/estimates/${id}`, { method: "DELETE" }, cookie).catch(() => {});
      }
      await pool.end();
    }
  });
});
