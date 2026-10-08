import { describe, expect, it } from "vitest";
import { buildPlanner, cleanTerms, fetchPlanner, plannerDeps, plannerEstimateUsd, plannerInput, plannerTooLong, rankingsRequest, volumesRequest } from "./planner";
import { DataForSeoError } from "./dataforseo";

const loc = { locationCode: 2840, languageCode: "en" };
const input = { domain: "alpine.example", ...loc, services: ["siding", "roofing"], towns: ["bellingham", "lynden"], fetchedAt: "2026-10-08T00:00:00.000Z" };
const vol = (keyword: string, volume: number | null, kd = 10.4, cpc = 6.789) => ({ keyword, keyword_info: { search_volume: volume, cpc }, keyword_properties: { keyword_difficulty: kd } });
const rank = (keyword: string, position: number, path: string) => ({ keyword_data: { keyword }, ranked_serp_element: { serp_item: { rank_group: position, url: `https://alpine.example${path}` } } });
const ok = (items: unknown[], cost: number) => ({ status_code: 20000, tasks: [{ status_code: 20000, cost, result: [{ items }] }] });

describe("service-area planner", () => {
  it("takes plain words for services and towns, within its limits", () => {
    expect(plannerInput.parse({ services: [" Siding "], towns: ["Mount Vernon"] })).toMatchObject({ services: ["Siding"], towns: ["Mount Vernon"], peek: false, refresh: false });
    expect(plannerInput.safeParse({ services: ["site:x.com siding"], towns: ["a b"] }).success).toBe(false);
    expect(plannerInput.safeParse({ services: ["siding"], towns: [] }).success).toBe(false);
    expect(plannerInput.safeParse({ services: Array.from({ length: 13 }, (_, i) => `service ${i}`), towns: ["bellingham"] }).success).toBe(false);
    expect(cleanTerms([" Siding ", "siding", "ROOF  repair", ""])).toEqual(["siding", "roof repair"]);
    // A comma belongs to the line it is on: "Bellingham, WA" is one town.
    expect(cleanTerms(["Bellingham, WA", "bellingham wa"])).toEqual(["bellingham wa"]);
    expect(plannerInput.safeParse({ services: ["siding"], towns: ["Bellingham, WA"] }).success).toBe(true);
    // Every pairing must be a search the source accepts: at most 80 characters and ten words.
    expect(plannerTooLong(["siding"], ["bellingham"])).toBeNull();
    expect(plannerTooLong(["a".repeat(50)], ["b".repeat(40)])).toBe(`${"a".repeat(50)} ${"b".repeat(40)}`);
    expect(plannerTooLong(["one two three four five six"], ["seven eight nine ten eleven"])).toBe("one two three four five six seven eight nine ten eleven");
    expect(plannerEstimateUsd(28)).toBeCloseTo(2 * (0.012 + 28 * 0.00012), 6);
  });
  it("asks once for the volumes and once for the site's rankings of exactly these searches", () => {
    const kws = ["siding bellingham", "siding lynden"];
    expect(volumesRequest(kws, loc)).toEqual({ keywords: kws, location_code: 2840, language_code: "en" });
    expect(rankingsRequest("alpine.example", kws, loc)).toEqual({ target: "alpine.example", location_code: 2840, language_code: "en", item_types: ["organic"], limit: 2, filters: ["keyword_data.keyword", "in", kws] });
    // Never more rows than were reserved for: one per search.
    expect(rankingsRequest("alpine.example", Array.from({ length: 150 }, (_, i) => `k ${i}`), loc).limit).toBe(150);
  });
  it("builds the table: a number that is not known stays unknown, never zero", () => {
    const p = buildPlanner(input,
      [vol("siding bellingham", 70), vol("roofing bellingham", 210), vol("roofing lynden", null)],
      [rank("siding bellingham", 6, "/"), rank("siding bellingham", 14, "/siding"), rank("roofing bellingham", 2, "/roofing")]);
    expect(p.cells.map((c) => [c.keyword, c.volume, c.position, c.home])).toEqual([
      ["siding bellingham", 70, 6, true], ["siding lynden", null, null, false], ["roofing bellingham", 210, 2, false], ["roofing lynden", null, null, false],
    ]);
    expect(p.cells[0]).toMatchObject({ difficulty: 10, cpc: 6.79, url: "https://alpine.example/" });
    // Nothing is a gap here: the two searches the site does not rank for have no measurable searches.
    expect(p.summary).toEqual({ cells: 4, gaps: 0, gapVolume: 0, weak: 1, strong: 1, unknown: 2 });
    expect(p.missing).toEqual([]);
  });
  it("a gap is a search people make that the site does not rank for", () => {
    const p = buildPlanner(input, [vol("siding lynden", 40), vol("roofing lynden", 90), vol("siding bellingham", 70)], [rank("siding bellingham", 6, "/")]);
    expect(p.cells.filter((c) => c.position === null && (c.volume ?? 0) > 0).map((c) => c.keyword)).toEqual(["siding lynden", "roofing lynden"]);
    expect(p.summary).toMatchObject({ gaps: 2, gapVolume: 130, weak: 1, strong: 0, unknown: 1 });
  });
  it("when the rankings did not load, nothing is called a gap", () => {
    const p = buildPlanner(input, [vol("siding lynden", 40)], null);
    expect(p.missing).toEqual(["rankings"]);
    // Unknown, not zero: every count that needs the rankings.
    expect(p.summary).toEqual({ cells: 4, gaps: null, gapVolume: null, weak: null, strong: null, unknown: null });
    // And when it is the volumes that did not load, what the rankings alone can say is still said.
    const v = buildPlanner(input, null, [rank("siding bellingham", 6, "/"), rank("roofing bellingham", 2, "/roofing")]);
    expect([v.missing, v.summary]).toEqual([["volumes"], { cells: 4, gaps: null, gapVolume: null, weak: 1, strong: 1, unknown: null }]);
  });
  it("one lookup failing leaves a usable table and is not the customer's to pay for; both failing fails", async () => {
    const real = plannerDeps.request;
    try {
      plannerDeps.request = (async (_m: string, path: string) => { if (path.includes("ranked_keywords")) throw new DataForSeoError("task_failed", "no", 0.004); return ok([vol("siding bellingham", 70)], 0.0125); }) as any;
      const out = await fetchPlanner({ domain: "alpine.example", ...loc, services: ["siding"], towns: ["bellingham"] });
      expect(out.data.missing).toEqual(["rankings"]);
      expect(out.customerUsd).toBeCloseTo(0.0125, 6);
      expect(out.costUsd).toBeCloseTo(0.0165, 6);
      plannerDeps.request = (async () => { throw new DataForSeoError("timeout", "timed out"); }) as any;
      const failed: any = await fetchPlanner({ domain: "alpine.example", ...loc, services: ["siding"], towns: ["bellingham"] }).catch((e) => e);
      expect(failed).toBeInstanceOf(DataForSeoError);
      expect(failed.costUnknown).toBe(true);
    } finally { plannerDeps.request = real; }
  });
});
