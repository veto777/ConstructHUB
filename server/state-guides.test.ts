import { describe, expect, it } from "vitest";
import type { StateGuide } from "@shared/schema";
import { agencyChecklist, courseUnlocks, publicStateGuide, STATE_GUIDE_CATEGORY } from "./state-guides";

const MODULES = [
  { id: 1, category: "licensing" }, { id: 2, category: "gmb" }, { id: 3, category: "website" }, { id: 4, category: "seo" },
];
const none = { included: false, purchases: [] };

describe("courseUnlocks — what a purchase opens", () => {
  it("nothing bought, nothing included: every module stays locked", () => {
    const u = courseUnlocks(none, MODULES);
    expect(u).toEqual({ unlocked: { licensing: false, gmb: false, website: false, seo: false }, all: false, any: false, devPreview: false });
  });
  it("an included Master Class (plan module) opens all four without a purchase row", () => {
    const u = courseUnlocks({ included: true, purchases: [] }, MODULES);
    expect(u.all).toBe(true);
    expect(u.any).toBe(true);
    expect(Object.values(u.unlocked).every(Boolean)).toBe(true);
  });
  it("the bundle opens all four", () => {
    expect(courseUnlocks({ included: false, purchases: [{ moduleId: null, isBundle: true }] }, MODULES).all).toBe(true);
  });
  it("a module purchase opens the module whose CATEGORY it bought, by the module table, not an assumed id", () => {
    // The seeded order is licensing, gmb, website, seo — but ids are whatever the database assigned.
    const shuffled = [{ id: 11, category: "seo" }, { id: 12, category: "licensing" }, { id: 13, category: "gmb" }, { id: 14, category: "website" }];
    const u = courseUnlocks({ included: false, purchases: [{ moduleId: 12, isBundle: false }] }, shuffled);
    expect(u.unlocked).toEqual({ licensing: true, gmb: false, website: false, seo: false });
    expect(u.all).toBe(false);
    expect(u.any).toBe(true);
    expect(u.unlocked[STATE_GUIDE_CATEGORY]).toBe(true);
  });
  it("a purchase of a module that is no longer listed still counts as a purchase (the Ads guide rule) but opens no module", () => {
    const u = courseUnlocks({ included: false, purchases: [{ moduleId: 99, isBundle: false }] }, MODULES);
    expect(u.any).toBe(true);
    expect(Object.values(u.unlocked).some(Boolean)).toBe(false);
  });
  it("the dev preview bypass opens everything and says so", () => {
    const u = courseUnlocks(none, MODULES, true);
    expect(u.all).toBe(true);
    expect(u.devPreview).toBe(true);
  });
});

const guide: StateGuide = {
  id: 47, stateCode: "WA", stateName: "Washington", sosName: "Secretary of State",
  sosUrl: "https://www.sos.wa.gov/corps/", entityTypes: ["LLC", "Corporation"],
  licensingBoardName: "Labor & Industries", licensingBoardUrl: "https://lni.wa.gov/licensing-permits/contractors/",
  licensingRequired: true, licensingNotes: "Register as a contractor with L&I.",
  workersCompType: "state_fund", workersCompAgency: "Labor & Industries", workersCompUrl: "https://lni.wa.gov/insurance/",
  taxBoardName: "Department of Revenue", taxBoardUrl: "https://dor.wa.gov/", salesTaxOnLabor: true, bAndOTax: true,
  bondRequired: true, gcBondAmount: "$12,000", specialtyBondAmount: "$6,000",
  insuranceNotes: "General liability insurance required.", payrollNotes: "Register with ESD for unemployment insurance.",
  overview: "Washington requires contractor registration.",
  sosUrlStatus: "verified", licensingBoardUrlStatus: "unconfirmed", workersCompUrlStatus: "dead", taxBoardUrlStatus: "verified",
  linksCheckedAt: "2026-09-30", createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("publicStateGuide — the free comparison facts", () => {
  it("keeps the comparison-table columns and the filing office name, and drops every paid field", () => {
    const pub = publicStateGuide(guide, 8) as Record<string, unknown>;
    expect(pub).toEqual({
      id: 47, stateCode: "WA", stateName: "Washington", sosName: "Secretary of State", licensingRequired: true,
      workersCompType: "state_fund", salesTaxOnLabor: true, bAndOTax: true, bondRequired: true, linksCheckedAt: "2026-09-30",
      stepCount: 8, walkthrough: "written",
    });
    for (const paid of ["sosUrl", "licensingBoardUrl", "licensingBoardName", "workersCompUrl", "workersCompAgency", "taxBoardUrl", "taxBoardName",
      "licensingNotes", "insuranceNotes", "payrollNotes", "overview", "entityTypes", "gcBondAmount", "specialtyBondAmount"]) {
      expect(pub, paid).not.toHaveProperty(paid);
    }
  });
  it("a state without written steps is marked as checklist-only", () => {
    expect(publicStateGuide(guide, 0).walkthrough).toBe("checklist");
  });
});

describe("agencyChecklist — built from the record, never beyond it", () => {
  it("orders form → license → bond → workers' comp → tax → payroll and names each agency from the record", () => {
    const steps = agencyChecklist(guide);
    expect(steps.map((s) => s.category)).toEqual(["formation", "licensing", "licensing", "insurance", "tax", "payroll"]);
    expect(steps.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(steps[0].title).toBe("Form your business entity with the Secretary of State");
    expect(steps[0].description).toContain("LLC, Corporation");
    expect(steps[1].title).toBe("Apply for your contractor license with the Labor & Industries");
    expect(steps[1].description).toBe("Register as a contractor with L&I.");
    expect(steps[2].description).toContain("general contractor $12,000, specialty $6,000");
    expect(steps[3].description).toContain("state workers' compensation fund");
    expect(steps[4].description).toContain("sales tax on construction labor");
    expect(steps[4].description).toContain("business and occupation (B&O) tax");
    expect(steps[5].isRequired).toBe(false);
    expect(steps.every((s) => s.source === "agency-data")).toBe(true);
  });
  it("hands out checked links only: an unconfirmed link stays, a dead link becomes null", () => {
    const steps = agencyChecklist(guide);
    expect(steps[0].url).toBe("https://www.sos.wa.gov/corps/");
    expect(steps[1].url).toBe("https://lni.wa.gov/licensing-permits/contractors/");
    expect(steps[3].url).toBeNull();
  });
  it("a state without a statewide license, bond or payroll notes gets the local-licensing check and no invented steps", () => {
    const fl: StateGuide = { ...guide, stateCode: "FL", stateName: "Florida", licensingRequired: false, licensingNotes: null,
      licensingBoardName: null, licensingBoardUrl: null, bondRequired: false, gcBondAmount: null, specialtyBondAmount: null,
      payrollNotes: null, workersCompType: "private", salesTaxOnLabor: false, bAndOTax: false, insuranceNotes: null, entityTypes: null };
    const steps = agencyChecklist(fl);
    expect(steps.map((s) => s.category)).toEqual(["formation", "licensing", "insurance", "tax"]);
    expect(steps[1].title).toBe("Check city, county and trade licensing");
    expect(steps[1].description).toContain("no statewide contractor license");
    expect(steps[1].url).toBeNull();
    expect(steps[2].description).toContain("private insurer");
    expect(steps[3].description).toContain("Register your business for state taxes");
    expect(steps[0].description).not.toContain("registers");
  });
});
