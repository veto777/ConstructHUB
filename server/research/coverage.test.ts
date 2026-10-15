import { beforeAll, describe, expect, it } from "vitest";
import { STATE_CODES } from "@shared/research-reports";
import { coverageNote, nationwideNow, withFacets, type CoverageManifest, type CoverageSource, type CoverageState } from "@shared/research-coverage";
import { buildCoverageManifest, installNetworkGuard, kindOfLabel, probe } from "./coverage-manifest";

// The guard stubs this worker's network for good: every search below is a probe, never a real request.
let manifest: CoverageManifest;
beforeAll(async () => {
  installNetworkGuard();
  manifest = await buildCoverageManifest();
}, 120_000);

describe("coverage manifest (from the registry)", () => {
  it("covers all 50 states and DC, once each", () => {
    expect(manifest.states.map((s) => s.state).sort()).toEqual([...STATE_CODES].sort());
    expect(STATE_CODES).toHaveLength(51);
  });

  it("lists the original tables' sources with what the code says about them", () => {
    const by = (st: string, label: string) => manifest.states.find((s) => s.state === st)!.sources.find((x) => x.label === label);
    // A Socrata dataset: identifiers from its declared fields (WA: business, principals join, license number, phone, address).
    expect(by("WA", "Washington L&I contractor licenses")).toMatchObject({ kinds: ["licenses"], ids: ["name", "owner", "license", "phone", "address"], mode: "live" });
    // A file: a daily download, its loaded rows decide the rest.
    expect(by("FL", "Florida stop-work orders (Division of Workers' Compensation)")).toMatchObject({ kinds: ["stop_work"], mode: "file", refreshHours: 24, companiesOnly: true, fileId: "fl-stop-work" });
    // The original live enforcement, from the report's own source list.
    expect(by("TX", "TCEQ administrative orders")?.kinds).toEqual(["environmental"]);
    expect(manifest.states.find((s) => s.state === "TX")!.noStatewideGcLicense).toMatch(/does not license general contractors/);
  });

  it("every source can be searched some way, and nationwide records are listed once", () => {
    for (const s of manifest.states) for (const src of s.sources) expect(src.ids.length, `${s.state}: ${src.label}`).toBeGreaterThan(0);
    // CourtListener is off (its robots.txt disallows us), so it isn't claimed (audit 2026-10-15). OSHA is listed with
    // `needs: "osha"` whatever the build holds: the running server's key decides whether the page shows it (round 4).
    expect(manifest.nationwide.some((n) => /CourtListener/.test(n.label))).toBe(false);
    expect(manifest.nationwide.find((n) => /OSHA/.test(n.label))).toMatchObject({ needs: "osha" });
    expect(nationwideNow(manifest.nationwide, { osha: false }).some((n) => /OSHA/.test(n.label))).toBe(false);
    expect(nationwideNow(manifest.nationwide, { osha: true }).some((n) => /OSHA/.test(n.label))).toBe(true);
    expect(nationwideNow(manifest.nationwide, undefined).some((n) => /OSHA/.test(n.label))).toBe(false);
  });

  it("never publishes the blocked lists, only how many there are", () => {
    const json = JSON.stringify(manifest);
    expect(json).not.toContain("blocked");
    for (const s of manifest.states) expect(typeof s.unavailableCount).toBe("number");
  });
});

describe("probing a live lookup", () => {
  it("says a search runs when it reaches for the network, and skips when it returns at once", async () => {
    expect(await probe(async () => { await fetch("https://example.test/search?q=acme"); return []; })).toBe("runs");
    expect(await probe(async () => [])).toBe("skips");
    expect(await probe(async () => { throw new Error("not configured"); })).toBe("skips"); // round 2, decision 13: a key we don't hold is not a search that runs
    expect(await probe(async () => { throw new Error("unsupported search type"); })).toBe("skips");
  });
});

describe("kinds from labels", () => {
  it.each([
    ["Nevada Labor Commissioner disqualified contractors", "debarment"],
    ["New Jersey DOL Wage Violation Watchlist", "wage"],
    ["New Jersey DOL prevailing-wage debarments", "debarment"],
    ["TDEC enforcement cases", "environmental"],
    ["Iowa Secretary of State active business entities", "business_status"],
    ["Florida federal tax liens on businesses (Sunbiz)", "tax_lien"],
    ["Pennsylvania UJS court cases (web portal)", "courts"],
    ["Nevada State Contractors Board disciplinary and board actions (2001 to today)", "discipline"],
  ])("%s → %s", (label, kind) => expect(kindOfLabel(label)).toBe(kind));
});

describe("page helpers", () => {
  const src = (o: Partial<CoverageSource>): CoverageSource => ({ label: "x", kinds: ["licenses"], ids: ["name"], mode: "file", companiesOnly: false, url: null, ...o });
  it("a loaded file shows the identifiers its rows carry (never people on a companies-only file)", () => {
    const facets = { "fl-eclb": { rows: 10, loadedAt: "2026-10-15", ids: ["name", "owner", "license", "address"] as const, kinds: ["licenses"] as const } };
    expect(withFacets(src({ fileId: "fl-eclb" }), facets as any).ids).toEqual(["name", "owner", "license", "address"]);
    expect(withFacets(src({ fileId: "fl-eclb", companiesOnly: true, kinds: ["complaints"] }), facets as any).ids).toEqual(["name", "license", "address"]);
    expect(withFacets(src({ fileId: "other" }), facets as any).ids).toEqual(["name"]);
  });
  it("says plainly when a state has little to search", () => {
    const st = (sources: CoverageSource[], unavailableCount = 0): CoverageState => ({ state: "ZZ", checked: null, sources, noStatewideGcLicense: null, unavailableCount });
    expect(coverageNote(st([]))).toMatch(/don't search any of this state's own records yet/);
    expect(coverageNote(st([src({ kinds: ["discipline"], companiesOnly: true })], 4))).toMatch(/block automated searches/);
    expect(coverageNote(st([src({})], 4))).toMatch(/Most of this state's other license lookups/);
    expect(coverageNote(st([src({}), src({})], 4))).toBeNull();
  });
});
