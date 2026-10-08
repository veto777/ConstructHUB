import { afterEach, describe, expect, it } from "vitest";
import { batchDeps, batchEstimateUsd, batchInput, cleanDomains, fetchBatch } from "./batch";

const original = { ...batchDeps };
afterEach(() => { Object.assign(batchDeps, original); });
const ok = (items: unknown[], cost: number) => ({ status_code: 20000, tasks: [{ status_code: 20000, cost, result: [{ items }] }] });

describe("cleanDomains", () => {
  it("accepts URLs and www, drops duplicates and things that are not websites, and caps", () => {
    expect(cleanDomains(["https://www.Example.com/page", "example.com", " b.org ", "not a site", "", "c.net"], 2)).toEqual({ domains: ["example.com", "b.org"], rejected: ["not a site"] });
  });
  it("validates the request", () => {
    expect(batchInput.safeParse({ domains: ["a.com"] }).success).toBe(true);
    expect(batchInput.safeParse({ domains: [] }).success).toBe(false);
    expect(batchInput.safeParse({ domains: ["a.com"], x: 1 }).success).toBe(false);
  });
});

describe("batchEstimateUsd", () => {
  it("covers what was measured: five sites cost $0.0851", () => {
    expect(batchEstimateUsd(5)).toBeGreaterThan(3 * 0.02418 + 0.0126);
    expect(batchEstimateUsd(100)).toBeLessThan(0.15);
  });
});

describe("fetchBatch", () => {
  const answers: Record<string, unknown> = {
    "/backlinks/bulk_ranks/live": ok([{ target: "a.com", rank: 374 }, { target: "www.b.com", rank: 51 }], 0.024),
    "/backlinks/bulk_referring_domains/live": ok([{ target: "a.com", referring_domains: 2693 }], 0.024),
    "/backlinks/bulk_backlinks/live": ok([{ target: "a.com", backlinks: 31990 }], 0.024),
    "/dataforseo_labs/google/bulk_traffic_estimation/live": ok([{ target: "a.com", metrics: { organic: { etv: 54.1, count: 74 } } }], 0.0126),
  };
  it("joins the four lookups per site, in the order asked", async () => {
    const sent: string[] = [];
    batchDeps.request = (async (_m: string, path: string, body: any) => { sent.push(path); expect(body[0].targets).toEqual(["b.com", "a.com", "c.com"]); return answers[path]; }) as typeof batchDeps.request;
    const out = await fetchBatch(["b.com", "a.com", "c.com"]);
    expect(sent).toHaveLength(4);
    expect(out.data.rows).toEqual([
      { domain: "b.com", authority: 5, referringDomains: null, backlinks: null, traffic: null, keywords: null },
      { domain: "a.com", authority: 37, referringDomains: 2693, backlinks: 31990, traffic: 54, keywords: 74 },
      { domain: "c.com", authority: null, referringDomains: null, backlinks: null, traffic: null, keywords: null },
    ]);
    expect(out.data.missing).toEqual([]);
    expect(out.costUsd).toBeCloseTo(0.0846, 6);
  });
  it("a lookup that fails leaves its column empty and is named; its cost still counts", async () => {
    batchDeps.request = (async (_m: string, path: string) => { if (path.includes("traffic")) throw Object.assign(new Error("timed out"), { code: "timeout", costUsd: 0 }); return answers[path]; }) as typeof batchDeps.request;
    const out = await fetchBatch(["a.com"]);
    expect(out.data.missing).toEqual(["traffic"]);
    expect(out.data.rows[0]).toMatchObject({ authority: 37, traffic: null, keywords: null });
    expect(out.costUnknown).toBe(true);
    expect(out.costUsd).toBeCloseTo(0.072, 6);
  });
  it("everything failing throws with what it cost", async () => {
    batchDeps.request = (async () => { throw Object.assign(new Error("boom"), { costUsd: 0.01 }); }) as typeof batchDeps.request;
    const e: any = await fetchBatch(["a.com"]).catch((x) => x);
    expect(e.message).toBe("boom");
    expect(e.costUsd).toBeCloseTo(0.04, 6);
  });
});
