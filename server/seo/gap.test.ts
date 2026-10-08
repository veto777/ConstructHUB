import { afterEach, describe, expect, it } from "vitest";
import { fetchGap, gapDeps, gapEstimateUsd, gapInput, mergeContentGap, parseLinkIntersect } from "./gap";

const kw = (keyword: string, position: number, volume: number | null, etv = 10) =>
  ({ keyword, searchVolume: volume, cpc: 1, difficulty: 20, competition: null, intent: "commercial", competitorPosition: position, competitorUrl: `https://c/${keyword}`, ourPosition: null, etv });

const original = { ...gapDeps };
afterEach(() => { Object.assign(gapDeps, original); });

describe("gapInput", () => {
  it("takes one to three competitors and nothing unknown", () => {
    expect(gapInput.safeParse({ kind: "content", domain: "a.com", competitors: ["b.com"] }).success).toBe(true);
    expect(gapInput.safeParse({ kind: "content", domain: "a.com", competitors: [] }).success).toBe(false);
    expect(gapInput.safeParse({ kind: "links", domain: "a.com", competitors: ["b.com", "c.com", "d.com", "e.com"] }).success).toBe(false);
    expect(gapInput.safeParse({ kind: "links", domain: "a.com", competitors: ["b.com"], limit: 30 }).success).toBe(false);
    expect(gapInput.safeParse({ kind: "links", domain: "a.com", competitors: ["b.com"], extra: 1 }).success).toBe(false);
  });
});

describe("gapEstimateUsd", () => {
  it("content gap is one keyword comparison per competitor", () => {
    expect(gapEstimateUsd("content", 3, 50)).toBeCloseTo(3 * gapEstimateUsd("content", 1, 50), 6);
  });
  it("link intersect covers the measured cost with room to spare", () => {
    // Measured: 50 rows = $0.0258; 25 rows = $0.0249 with one target or two.
    expect(gapEstimateUsd("links", 2, 50)).toBeGreaterThan(0.0258);
    expect(gapEstimateUsd("links", 1, 25)).toBeGreaterThan(0.0249);
    expect(gapEstimateUsd("links", 3, 100)).toBeLessThan(0.04);
  });
});

describe("mergeContentGap", () => {
  it("puts keywords more competitors share first, then by volume, and sums traffic", () => {
    const rows = mergeContentGap([
      { competitor: "b.com", items: [kw("roof repair", 4, 1000, 30), kw("siding", 2, 9000)] },
      { competitor: "c.com", items: [kw("roof repair", 1, 1000, 50), kw("gutters", 3, 500)] },
    ]);
    expect(rows.map((r) => r.keyword)).toEqual(["roof repair", "siding", "gutters"]);
    expect(rows[0].competitors).toEqual([{ domain: "c.com", position: 1, url: "https://c/roof repair" }, { domain: "b.com", position: 4, url: "https://c/roof repair" }]);
    expect(rows[0].traffic).toBe(80);
  });
  it("counts a competitor once per keyword and fills a missing volume from another list", () => {
    const rows = mergeContentGap([
      { competitor: "b.com", items: [kw("x", 5, null), kw("x", 9, 100)] },
      { competitor: "c.com", items: [kw("x", 2, 700)] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].competitors).toHaveLength(2);
    expect(rows[0].volume).toBe(700);
  });
});

describe("parseLinkIntersect", () => {
  const item = { domain_intersection: {
    "1": { target: "blog.example.com", rank: 247, backlinks: 73, first_seen: "2026-02-08 02:45:16 +00:00", backlinks_spam_score: 5 },
    "2": { target: "blog.example.com", rank: 247, backlinks: 7, first_seen: null, backlinks_spam_score: 5 },
  } };
  it("reads the linking site and its links to each competitor in order", () => {
    expect(parseLinkIntersect(item, ["b.com", "c.com"])).toEqual({
      domain: "blog.example.com", authority: 25, spamScore: 5,
      links: [{ competitor: "b.com", backlinks: 73, firstSeen: "2026-02-08" }, { competitor: "c.com", backlinks: 7, firstSeen: null }],
    });
  });
  it("skips an item with no intersection", () => {
    expect(parseLinkIntersect({}, ["b.com"])).toBeNull();
    expect(parseLinkIntersect({ domain_intersection: {} }, ["b.com"])).toBeNull();
  });
});

describe("fetchGap", () => {
  const input = { target: "a.com", limit: 50, offset: 0, locationCode: 2840, languageCode: "en" };
  it("content gap: one competitor failing is reported as missing and its siblings still count", async () => {
    gapDeps.labsDomainIntersection = (async (i: any) => {
      if (i.competitor === "c.com") throw Object.assign(new Error("boom"), { costUsd: 0.001 });
      return { data: { items: [kw("roof repair", 4, 1000)], totalCount: 1 }, costUsd: 0.02 };
    }) as typeof gapDeps.labsDomainIntersection;
    const out = await fetchGap({ ...input, kind: "content", competitors: ["b.com", "c.com"] });
    expect(out.data.missing).toEqual(["c.com"]);
    expect(out.data.rows).toHaveLength(1);
    expect(out.costUsd).toBeCloseTo(0.021, 6);
  });
  it("content gap: every competitor failing throws with what it cost", async () => {
    gapDeps.labsDomainIntersection = (async () => { throw Object.assign(new Error("boom"), { costUsd: 0.001 }); }) as typeof gapDeps.labsDomainIntersection;
    const e: any = await fetchGap({ ...input, kind: "content", competitors: ["b.com", "c.com"] }).catch((x) => x);
    expect(e.message).toBe("boom");
    expect(e.costUsd).toBeCloseTo(0.002, 6);
  });
  it("link intersect: sends the competitors as numbered targets and excludes the site itself", async () => {
    let sent: any = null;
    gapDeps.request = (async (_m: string, path: string, body: any) => {
      sent = { path, body: body[0] };
      return { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.0258, result: [{ total_count: 2875, items: [{ domain_intersection: { "1": { target: "x.com", rank: 300, backlinks: 2 }, "2": { target: "x.com", rank: 300, backlinks: 1 } } }] }] }] };
    }) as typeof gapDeps.request;
    const out = await fetchGap({ ...input, kind: "links", competitors: ["b.com", "c.com"], offset: 50 });
    expect(sent.path).toBe("/backlinks/domain_intersection/live");
    expect(sent.body).toMatchObject({ targets: { "1": "b.com", "2": "c.com" }, exclude_targets: ["a.com"], limit: 50, offset: 50 });
    expect(out.data.total).toBe(2875);
    expect((out.data.rows[0] as any).domain).toBe("x.com");
    expect(out.costUsd).toBe(0.0258);
  });
});
