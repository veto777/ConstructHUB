import { afterEach, describe, expect, it } from "vitest";
import { bulkEstimateUsd, bulkInput, cleanKeywords, fetchBulkKeywords, listDeps, listItemsInput, BULK_MAX } from "./lists";
import { usageRow } from "./usage";

const original = { ...listDeps };
afterEach(() => { Object.assign(listDeps, original); });

describe("cleanKeywords", () => {
  it("lower-cases, collapses spaces, drops duplicates and empties, and caps", () => {
    expect(cleanKeywords(["  Roof   Repair ", "roof repair", "", "SIDING", "x".repeat(201)])).toEqual(["roof repair", "siding"]);
    expect(cleanKeywords(Array.from({ length: 500 }, (_, i) => `k${i}`))).toHaveLength(BULK_MAX);
    expect(cleanKeywords(["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });
});

describe("bulk analysis", () => {
  it("validates the request", () => {
    expect(bulkInput.safeParse({ keywords: ["a"] }).success).toBe(true);
    expect(bulkInput.safeParse({ keywords: [] }).success).toBe(false);
    expect(bulkInput.safeParse({ keywords: ["a"], extra: 1 }).success).toBe(false);
  });
  it("costs what was measured: 5 keywords $0.01248, 100 keywords $0.024", () => {
    expect(bulkEstimateUsd(5)).toBeGreaterThanOrEqual(0.01248);
    expect(bulkEstimateUsd(100)).toBeGreaterThanOrEqual(0.02352);
    expect(bulkEstimateUsd(100)).toBeLessThan(0.03);
  });
  it("returns rows in the order asked and names the keywords with no numbers", async () => {
    let sent: any = null;
    listDeps.request = (async (_m: string, path: string, body: any) => {
      sent = { path, body: body[0] };
      return { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.01236, result: [{ items: [
        { keyword: "siding", keyword_info: { search_volume: 9000, cpc: 4.126 }, keyword_properties: { keyword_difficulty: 24 }, search_intent_info: { main_intent: "commercial" } },
        { keyword: "roof repair", keyword_info: { search_volume: 74000 }, keyword_properties: { keyword_difficulty: 7 } },
      ] }] }] };
    }) as typeof listDeps.request;
    const out = await fetchBulkKeywords({ keywords: ["roof repair", "zzqx", "siding"], locationCode: 2840, languageCode: "en" });
    expect(sent.path).toBe("/dataforseo_labs/google/keyword_overview/live");
    expect(sent.body.keywords).toEqual(["roof repair", "zzqx", "siding"]);
    expect(out.data.rows.map((r) => [r.keyword, r.volume, r.difficulty])).toEqual([["roof repair", 74000, 7], ["siding", 9000, 24]]);
    expect(out.data.notFound).toEqual(["zzqx"]);
    expect(out.costUsd).toBe(0.01236);
  });
});

describe("listItemsInput", () => {
  it("needs a list or a name, and rounds the numbers a report hands over", () => {
    expect(listItemsInput.safeParse({ items: [{ keyword: "a" }] }).success).toBe(false);
    const ok = listItemsInput.parse({ name: " Tampa roofing ", items: [{ keyword: "roof repair", volume: 880.4, difficulty: 6.6, cpc: 4.12, intent: "commercial" }] });
    expect(ok.name).toBe("Tampa roofing");
    expect(ok.items[0]).toMatchObject({ volume: 880, difficulty: 7, cpc: 4.12 });
    expect(listItemsInput.safeParse({ listId: 1, items: [{ keyword: "a", difficulty: 140 }] }).success).toBe(false);
  });
});

describe("usageRow", () => {
  const base = { id: "r1", label: "Keyword overview — roof repair", created_at: "2026-10-08T12:00:00Z", estimate_usd: "0.05" };
  it("a settled lookup shows what the customer paid, at their price", () => {
    expect(usageRow({ ...base, settled_at: "2026-10-08T12:00:05Z", customer_usd: "0.04", credit: { fromIncluded: 20, fromWallet: 0 } }))
      .toEqual({ id: "r1", at: "2026-10-08T12:00:00Z", what: "Keyword overview — roof repair", status: "charged", cents: 16, fromIncluded: 16, fromPurchased: 0 });
  });
  it("a failed lookup is free", () => {
    expect(usageRow({ ...base, settled_at: "2026-10-08T12:00:05Z", customer_usd: "0", credit: { fromIncluded: 20, fromWallet: 0 } })).toMatchObject({ status: "free", cents: 0 });
  });
  it("splits a charge between included data and purchased credit", () => {
    expect(usageRow({ ...base, settled_at: "x", customer_usd: "0.05", credit: { fromIncluded: 8, fromWallet: 12 } })).toMatchObject({ cents: 20, fromIncluded: 8, fromPurchased: 12 });
  });
  it("one still running shows what is being held", () => {
    expect(usageRow({ ...base, settled_at: null, customer_usd: null, credit: { fromIncluded: 20, fromWallet: 0 } })).toMatchObject({ status: "running", cents: 20 });
  });
  it("an account with unlimited data is charged nothing, and a lookup with no label still has a name", () => {
    expect(usageRow({ ...base, label: null, settled_at: "x", customer_usd: "0.04", credit: null })).toMatchObject({ what: "SEO data lookup", status: "free", cents: 0 });
  });
});
