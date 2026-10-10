import { describe, expect, it, vi } from "vitest";
vi.mock("../storage", () => ({ storage: {} }));
import { readFileSync } from "fs";
import { getAdapter, getAdapterFor, isLegacyAdapter, listPlatformLabels, registerJurisdictionAdapter, renderScrapablePlatformsModule, supportsAlerts } from "./registry";
import { SCRAPABLE_PLATFORM_LABELS, ADAPTER_JURISDICTIONS, isScrapablePlatform } from "../../shared/scrapable-platforms";
import type { PortalAdapter } from "./types";

describe("adapter registry", () => {
  it("resolves exact labels and aliases case-insensitively", () => {
    expect(getAdapter("Accela")).not.toBeNull();
    expect(getAdapter("accela citizen access")).toBe(getAdapter("Accela"));
    expect(getAdapter("  TYLER ENERGOV ")).toBe(getAdapter("Tyler EnerGov"));
    expect(getAdapter("City building permits page")).toBeNull();
    expect(getAdapter(null)).toBeNull();
  });
  it("marks the scraper.ts wrappers as legacy (no listRecent)", () => {
    const a = getAdapter("SmartGov")!;
    expect(isLegacyAdapter(a)).toBe(true);
    expect(a.capabilities.listRecent).toBe(false);
    expect(supportsAlerts("SmartGov")).toBe(false);
  });
  it("prefers a jurisdiction-specific adapter over the platform adapter", () => {
    const fake: PortalAdapter = { platform: "Test open data", capabilities: { search: ["address"], listRecent: true, detail: false }, search: async () => [], listRecent: async () => [] };
    registerJurisdictionAdapter("Testville, ZZ", fake);
    expect(getAdapterFor({ platform: "Accela", jurisdiction: "testville, zz" })).toBe(fake);
    expect(getAdapterFor({ platform: "Accela", jurisdiction: "Elsewhere, ZZ" })).toBe(getAdapter("Accela"));
    expect(getAdapterFor({ platform: null, jurisdiction: null })).toBeNull();
    expect(isLegacyAdapter(fake)).toBe(false);
  });
  it("keeps shared/scrapable-platforms.ts in sync with the registry (run scripts/sync-scrapable-platforms.ts)", () => {
    const onDisk = readFileSync(new URL("../../shared/scrapable-platforms.ts", import.meta.url), "utf8");
    // The test above registered a fake jurisdiction; compare the platform labels only, and the committed
    // jurisdiction list against the registry minus that fake.
    const labels = listPlatformLabels();
    expect([...SCRAPABLE_PLATFORM_LABELS]).toEqual(labels);
    for (const l of labels) expect(isScrapablePlatform(l.toUpperCase())).toBe(true);
    const rendered = renderScrapablePlatformsModule({ excludeJurisdictions: ["testville, zz"] });
    expect(onDisk).toBe(rendered);
    expect(ADAPTER_JURISDICTIONS.every((j) => j === j.toLowerCase())).toBe(true);
  });
});
