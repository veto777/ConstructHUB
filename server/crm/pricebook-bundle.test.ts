/**
 * Owner requests of 2026-10-21 on the New-estimate dialog:
 *  - price-book memory: most-used first, never-used last; the last billed price/scope prefills
 *    (shared/pricebook-usage.ts, server/crm/pricebook-usage.ts);
 *  - the tiered, category-gated bundle (Alpine): siding + windows + roofing 5%, any two 2%, painting/gutters/doors
 *    never count (shared/scope-category.ts), recomputed by the server on approve (discounts.ts);
 *  - the contractor's own discount as a kind:"discount" line through the shared totals (shared/estimate-draft.ts).
 * Pure rules first, then in-process routes on the lane Postgres (throwaway org, deleted afterwards).
 */
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { lastUsedLabel, prefillPrice, rankPricebookItems } from "@shared/pricebook-usage";
import { ALPINE_BUNDLE_RULE, bundleRuleText, categoryFromText, effectiveOffer, lineCategory } from "@shared/scope-category";
import { autosavePayload, contractorDiscountLine, defaultOffers } from "@shared/estimate-draft";
import { DISCOUNT_PRESETS } from "@shared/discount-presets";
import { computeApprovalTotals } from "@shared/estimate-totals";
import { computeBallpark } from "@shared/self-estimate";

vi.mock("../email", () => ({ sendWithFallback: vi.fn(async () => ({ accepted: ["fixture@example.invalid"] })) }));

describe("price-book ordering", () => {
  const items = [
    { name: "Door Remodel" }, { name: "Exterior Painting", useCount: 3, lastUsedAt: "2026-10-01T00:00:00Z" },
    { name: "Metal Roof" }, { name: "Seamless Gutter", useCount: 3, lastUsedAt: "2026-10-20T00:00:00Z" },
    { name: "Siding Remodel - James Hardie", useCount: 9, lastUsedAt: "2026-09-01T00:00:00Z" },
  ];
  it("most-used first, recency breaks ties, never-used last in their incoming order", () => {
    expect(rankPricebookItems(items).map((i) => i.name)).toEqual([
      "Siding Remodel - James Hardie", "Seamless Gutter", "Exterior Painting", "Door Remodel", "Metal Roof",
    ]);
  });
  it("while typing, text relevance comes first, then usage", () => {
    const list = [{ name: "Gutter Guards" }, { name: "Remove gutters", useCount: 5 }, { name: "Seamless Gutter", useCount: 1 }];
    expect(rankPricebookItems(list, "gutter").map((i) => i.name)).toEqual(["Gutter Guards", "Remove gutters", "Seamless Gutter"]);
  });
  it("prefills the last billed price and labels it against the list price", () => {
    const used = { useCount: 2, lastPriceCents: 1650 };
    expect(prefillPrice(2500, used)).toBe(1650);
    expect(prefillPrice(2500, { useCount: 0, lastPriceCents: null })).toBe(2500);
    expect(lastUsedLabel(2500, used, "sf")).toBe("$16.50/sf last used · $25/sf list");
    expect(lastUsedLabel(2500, { useCount: 2, lastPriceCents: 2500 })).toBeNull();
  });
});

describe("scope categories and the tiered bundle", () => {
  const L = (name: string, scopeCategory: string | null = null) => ({ kind: "labor", name, scopeCategory });
  const bundle = { percentBps: 500, rule: ALPINE_BUNDLE_RULE };
  it("categorizes from the line name", () => {
    expect(categoryFromText("Siding Remodel - Primed (NO PAINT)")).toBe("siding");
    expect(categoryFromText("James Hardie lap")).toBe("siding");
    expect(categoryFromText("Metal Roof")).toBe("roofing");
    expect(categoryFromText("Vinyl Window")).toBe("windows");
    expect(categoryFromText("Exterior Painting")).toBe("painting");
    expect(categoryFromText("Seamless Gutter")).toBe("gutters");
    expect(categoryFromText("Door Remodel")).toBe("doors");
    expect(lineCategory(L("Exterior Painting", "siding"))).toBe("siding"); // a stored correction wins
  });
  it("0 and 1 qualifying categories: not available, with the reason", () => {
    expect(effectiveOffer(bundle, [])).toMatchObject({ available: false, percentBps: 0 });
    const one = effectiveOffer(bundle, [L("Siding Remodel"), L("Siding repair")]); // two siding lines = one scope
    expect(one).toMatchObject({ available: false, percentBps: 0, categories: ["siding"] });
    expect(one.reason).toBe("Needs 2 of siding, windows, roofing on the estimate (has siding)");
  });
  it("2 categories → 2%, 3 → 5%", () => {
    expect(effectiveOffer(bundle, [L("Siding Remodel"), L("Metal Roof")])).toMatchObject({ available: true, percentBps: 200 });
    expect(effectiveOffer(bundle, [L("Siding Remodel"), L("Metal Roof"), L("Vinyl Window")])).toMatchObject({ available: true, percentBps: 500 });
  });
  it("painting + gutters + siding → 0% (painting and gutters never count); doors don't either", () => {
    expect(effectiveOffer(bundle, [L("Exterior Painting"), L("Seamless Gutter"), L("Siding Remodel")])).toMatchObject({ available: false, percentBps: 0 });
    expect(effectiveOffer(bundle, [L("Door Remodel"), L("Siding Remodel")])).toMatchObject({ available: false });
  });
  it("the dialog's default offers carry the org's rule", () => {
    const offers = defaultOffers({ discountRules: { bundle: ALPINE_BUNDLE_RULE } }, DISCOUNT_PRESETS);
    expect(offers.find((o) => o.code === "bundle")?.rule).toEqual(ALPINE_BUNDLE_RULE);
    expect(offers.find((o) => o.code === "military")?.rule).toBeNull();
    expect(defaultOffers({}, DISCOUNT_PRESETS).find((o) => o.code === "bundle")?.rule).toBeNull();
  });
  it("an org without a rule keeps the flat bundle; the rule reads in words", () => {
    expect(effectiveOffer({ percentBps: 500 }, [])).toMatchObject({ available: true, percentBps: 500 });
    expect(bundleRuleText(ALPINE_BUNDLE_RULE)).toBe("−5% for siding + windows + roofing, −2% for any two of them");
  });
  it("the client self-estimate ballpark applies the same tiers to the chosen trades", () => {
    const priced: any = { rangeBps: 0, disclaimer: "", trades: [], discounts: [{ code: "bundle", label: "Bundle", percentBps: 500, conditions: null, rule: ALPINE_BUNDLE_RULE }] };
    const bp = computeBallpark(priced, {} as any, { trades: [], discountCodes: ["bundle"] } as any);
    expect(bp.discounts).toEqual([]); // no qualifying trades → no bundle
  });
});

describe("contractor discount in the dialog", () => {
  const items = [{ kind: "labor", name: "Siding", quantityMilli: 2_200_000, unitPriceCents: 1650, taxable: true }];
  it("a $ or % discount becomes a kind:\"discount\" line and the shared totals tax after it", () => {
    const pct = contractorDiscountLine({ mode: "percent", value: "10", label: "Fall special" }, items)!;
    expect(pct).toMatchObject({ kind: "discount", name: "Fall special (10%)", unitPriceCents: 363_000, taxable: false });
    const amt = contractorDiscountLine({ mode: "amount", value: "500", label: "" }, items)!;
    expect(amt).toMatchObject({ name: "Discount", unitPriceCents: 50_000 });
    const t = computeApprovalTotals([...items, pct], 890, []);
    expect(t).toMatchObject({ subtotalCents: 3_630_000, lineDiscountCents: 363_000, taxCents: Math.round(3_267_000 * 0.089), });
    expect(autosavePayload({ title: "x", intro: "", taxPct: "8.9", taxTouched: true, items, contractorDiscount: { mode: "amount", value: "500", label: "" } }).items.at(-1))
      .toMatchObject({ kind: "discount", unitPriceCents: 50_000 });
    expect(contractorDiscountLine({ mode: "amount", value: "", label: "x" }, items)).toBeNull();
  });
});

const lane = (() => {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return /^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(u.pathname) && ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch { return false; }
})();

describe.skipIf(!lane)("price-book memory and the bundle through the routes (lane Postgres)", () => {
  let pool: typeof import("../db").pool;
  let base = "", server: ReturnType<express.Express["listen"]>;
  let userId = 0, orgId = "", customerId = "";
  const pb: Record<string, string> = {};

  async function call(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const r = await fetch(base + path, {
      method, headers: { "content-type": "application/json", "x-fixture-user": String(userId) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  }
  const line = (name: string, cents: number, extra: Record<string, unknown> = {}) =>
    ({ name, unitPriceCents: cents, quantityMilli: 1000, ...extra });

  beforeAll(async () => {
    ({ pool } = await import("../db"));
    await (await import("./schema-ensure")).ensureCrmSchema();
    userId = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`i-pbmem-${randomUUID()}@example.invalid`])).rows[0].id;
    await pool.query("INSERT INTO crm_subscriptions(user_id,plan,status) VALUES($1,'crm_essentials','active')", [userId]);
    const { registerCrmRoutes } = await import("./routes");
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: Number(req.headers["x-fixture-user"]) }; req.session = {}; next(); });
    registerCrmRoutes(app, (req: any) => req.user);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await call("/api/crm/me")).status).toBe(200);
    orgId = (await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id=$1", [userId])).rows[0].id;
    for (const [k, name, cents] of [["siding", "Siding Remodel - James Hardie", 2500], ["door", "Door Remodel", 500000], ["gutter", "Seamless Gutter", 2000], ["paint", "Exterior Painting", 400]] as const) {
      pb[k] = randomUUID();
      await pool.query(`INSERT INTO crm_pb_items(id, org_id, name, unit, pricing_mode, flat_price_cents) VALUES($1,$2,$3,'ea','flat',$4)`, [pb[k], orgId, name, cents]);
    }
    customerId = (await call("/api/crm/customers", { displayName: "Bundle Client", addressLine1: "1 Main St", email: `b-${randomUUID()}@example.invalid` })).data.id;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    if (orgId) {
      const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.columns
         WHERE table_schema='public' AND column_name='org_id' AND table_name LIKE 'crm\\_%' AND table_name <> 'crm_orgs'`);
      for (const { table_name } of rows) await pool.query(`DELETE FROM ${table_name} WHERE org_id=$1`, [orgId]).catch(() => {});
      await pool.query("DELETE FROM crm_orgs WHERE id=$1", [orgId]);
    }
    await pool.query("DELETE FROM crm_subscriptions WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  });

  it("counts once per estimate (autosave PATCHes don't add), remembers the last price; the picker lists most-used first", async () => {
    const est = await call("/api/crm/estimates", { customerId, autosave: true, items: [line("Siding Remodel - James Hardie", 1650, { pricebookItemId: pb.siding })] });
    expect(est.status, JSON.stringify(est.data)).toBe(201);
    for (const price of [1700, 1650]) {
      await call(`/api/crm/estimates/${est.data.id}`, { items: [line("Siding Remodel - James Hardie", price, { pricebookItemId: pb.siding, description: "ColorPlus lap" })] }, "PATCH");
    }
    await call("/api/crm/estimates", { customerId, items: [line("Siding", 1650, { pricebookItemId: pb.siding }), line("Gutter", 2000, { pricebookItemId: pb.gutter })] });
    // Another org's item id is ignored.
    await call("/api/crm/estimates", { customerId, items: [line("x", 1, { pricebookItemId: randomUUID() })] });
    const u = (await pool.query("SELECT item_id, use_count, last_price_cents, last_description FROM crm_pricebook_usage WHERE org_id=$1", [orgId])).rows;
    expect(u.find((r) => r.item_id === pb.siding)).toMatchObject({ use_count: 2, last_price_cents: 1650 });
    expect(u.find((r) => r.item_id === pb.gutter)).toMatchObject({ use_count: 1 });
    expect(u).toHaveLength(2);
    const list = await call("/api/crm/pricebook/items?sort=usage");
    expect(list.data.slice(0, 2).map((i: any) => i.id)).toEqual([pb.siding, pb.gutter]);
    expect(list.data[0]).toMatchObject({ useCount: 2, lastPriceCents: 1650, flatPriceCents: 2500 });
    // The list price is untouched until someone presses "Update price book".
    expect((await pool.query("SELECT flat_price_cents FROM crm_pb_items WHERE id=$1", [pb.siding])).rows[0].flat_price_cents).toBe(2500);
    // The price book page keeps its name order.
    expect((await call("/api/crm/pricebook/items")).data.map((i: any) => i.name)[0]).toBe("Door Remodel");
  });

  it("the server recomputes the tiered bundle from the stored lines on approve", async () => {
    const { recomputeApprovalTotals } = await import("./discounts");
    const make = async (items: any[]) => {
      const e = await call("/api/crm/estimates", { customerId, taxRateBps: 0, items });
      const put = await call(`/api/crm/estimates/${e.data.id}/discounts`, { offers: [
        { code: "bundle", label: "Bundle discount", percentBps: 500, enabled: true, rule: ALPINE_BUNDLE_RULE },
        { code: "military", label: "Military", percentBps: 200, enabled: true },
      ] }, "PUT");
      expect(put.status).toBe(200);
      const offers = put.data.offers as any[];
      return { id: e.data.id as string, bundleId: offers.find((o) => o.code === "bundle").id as string, milId: offers.find((o) => o.code === "military").id as string };
    };
    const two = await make([line("Siding Remodel", 100_000), line("Metal Roof", 100_000)]);
    let r = await recomputeApprovalTotals(orgId, two.id, 0, [two.bundleId]);
    expect(r.selections).toMatchObject([{ code: "bundle", percentBps: 200 }]);
    expect(r.totals.optionalDiscountCents).toBe(4_000);
    const three = await make([line("Siding Remodel", 100_000), line("Metal Roof", 100_000), line("Vinyl Window", 100_000)]);
    r = await recomputeApprovalTotals(orgId, three.id, 0, [three.bundleId]);
    expect(r.selections[0].percentBps).toBe(500);
    const none = await make([line("Exterior Painting", 100_000), line("Seamless Gutter", 100_000), line("Siding Remodel", 100_000)]);
    r = await recomputeApprovalTotals(orgId, none.id, 0, [none.bundleId, none.milId]);
    expect(r.selections.map((s) => s.code)).toEqual(["military"]); // the ticked bundle is dropped, never trusted
    // The org's own rule (Alpine: custom_fields.discountRules.bundle) applies to a plain "bundle" offer too, and other
    // orgs keep the flat bundle.
    const flat = await call("/api/crm/estimates", { customerId, taxRateBps: 0, items: [line("Siding Remodel", 100_000)] });
    const flatPut = await call(`/api/crm/estimates/${flat.data.id}/discounts`, { offers: [{ code: "bundle", label: "Bundle", percentBps: 500, enabled: true }] }, "PUT");
    r = await recomputeApprovalTotals(orgId, flat.data.id, 0, [flatPut.data.offers[0].id]);
    expect(r.selections[0].percentBps).toBe(500);
    await pool.query(`UPDATE crm_orgs SET custom_fields = coalesce(custom_fields,'{}'::jsonb) || $2::jsonb WHERE id=$1`,
      [orgId, JSON.stringify({ discountRules: { bundle: ALPINE_BUNDLE_RULE } })]);
    r = await recomputeApprovalTotals(orgId, flat.data.id, 0, [flatPut.data.offers[0].id]);
    expect(r.selections).toEqual([]); // one siding scope: no bundle under Alpine's rule
    const ruled = await call(`/api/crm/estimates/${flat.data.id}/discounts`, { offers: [{ code: "bundle", label: "Bundle", percentBps: 500, enabled: true }] }, "PUT");
    expect(ruled.data.offers[0].rule).toEqual(ALPINE_BUNDLE_RULE);
    // A line the contractor re-categorized counts as what it was set to.
    const fixed = await make([line("Siding Remodel", 100_000), line("Exterior Painting", 100_000, { scopeCategory: "windows" })]);
    r = await recomputeApprovalTotals(orgId, fixed.id, 0, [fixed.bundleId]);
    expect(r.selections[0].percentBps).toBe(200);
  });
});
