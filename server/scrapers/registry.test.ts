import { describe, expect, it } from "vitest";
import { getAdapter, listAdapters, registerAdapter, supportsAlerts, fromLegacyResult } from "./registry";

describe("adapter registry", () => {
  it("wraps the seven legacy adapters with listRecent off", () => {
    for (const label of ["SmartGov", "Skagit County", "Tyler EnerGov", "eTRAKiT", "Accela", "Click2Gov", "FTG Portal"]) {
      const a = getAdapter(label);
      expect(a, label).not.toBeNull();
      expect(a!.capabilities.listRecent, label).toBe(false);
      expect(supportsAlerts(label)).toBe(false);
    }
    expect(getAdapter("Tyler Technologies")?.platform).toBe("Tyler EnerGov");
    expect(getAdapter("Custom / GovPlatform")?.platform).toBe("Skagit County");
    expect(listAdapters().length).toBeGreaterThanOrEqual(7);
  });

  it("resolves the directory's label variants, never a different platform", () => {
    expect(getAdapter("eTRAKiT (CentralSquare)")?.platform).toBe("eTRAKiT");
    expect(getAdapter("Tyler EnerGov Citizen Self Service")?.platform).toBe("Tyler EnerGov");
    expect(getAdapter("Accela Citizen Access")?.platform).toBe("Accela");
    expect(getAdapter("Oregon ePermitting (Accela)")?.platform).toBe("Accela");
    expect(getAdapter("City building permits page")).toBeNull();
    expect(getAdapter("iWorQ")).toBeNull();
    expect(getAdapter(null)).toBeNull();
  });

  it("a registered adapter replaces the legacy wrapper and reports alerts support", () => {
    registerAdapter({ platform: "TestPortal", aliases: ["TestPortal CSS"], capabilities: { search: ["address"], listRecent: true, detail: false }, async search() { return []; }, async listRecent() { return []; } });
    expect(supportsAlerts("testportal css")).toBe(true);
    expect(getAdapter("TestPortal (cloud)")?.platform).toBe("TestPortal");
  });

  it("maps a legacy ScrapeResult to a PermitRecord, dropping rows without a permit number", () => {
    const base = { permitType: null, status: null, address: "1 Oak St", applicantName: null, contractorName: "Acme", description: null, issuedDate: "2026-10-01", parcelNumber: null, expirationDate: null, finalizedDate: null, district: null, contacts: [] };
    expect(fromLegacyResult({ ...base, permitNumber: null }, { databaseId: 1, jurisdiction: "X, OR" })).toBeNull();
    const r = fromLegacyResult({ ...base, permitNumber: "B-1", rawData: { detailUrl: "https://portal.example/B-1" } } as any, { databaseId: 1, jurisdiction: "X, OR" });
    expect(r).toMatchObject({ permitNumber: "B-1", databaseId: 1, jurisdiction: "X, OR", address: "1 Oak St", contractorName: "Acme", issuedAt: "2026-10-01", sourceUrl: "https://portal.example/B-1" });
  });
});
