/**
 * Contract checks for the dashboard skeleton: the sample payloads match
 * shared/dashboard.ts, and tile access follows the price book.
 */
import { describe, expect, it } from "vitest";
import { DASHBOARD_GROUPS, DASHBOARD_TILES, DASHBOARD_TILE_KEYS } from "@shared/dashboard";
import { PLANS, PLAN_KEYS } from "@shared/plans";
import { buildDashboardFixture, DASHBOARD_FIXTURE_SCENARIOS } from "./fixture";
import { cheapestPlanAllowing, tileAccess } from "./access";

const ALL = { agencyWorkspace: true, adsManager: true, cloudflareSearchConsole: true, domainsMailAlerts: true };
const NONE = { agencyWorkspace: false, adsManager: false, cloudflareSearchConsole: false, domainsMailAlerts: false };

describe("dashboard tile catalogue", () => {
  it("has unique keys, known groups and app-relative hrefs", () => {
    expect(new Set(DASHBOARD_TILE_KEYS).size).toBe(DASHBOARD_TILE_KEYS.length);
    const groups = new Set(DASHBOARD_GROUPS.map((g) => g.key));
    for (const t of DASHBOARD_TILES) {
      expect(groups.has(t.group)).toBe(true);
      expect(t.href.startsWith("/")).toBe(true);
    }
  });
});

describe("tileAccess", () => {
  const def = (key: string) => DASHBOARD_TILES.find((t) => t.key === key)!;

  it("reads the cheapest plan for an allowance from the price book", () => {
    for (const limit of ["protectedSites", "competitorScans", "teamTextSegments"] as const) {
      const first = PLAN_KEYS.find((k) => PLANS[k].limits[limit] !== 0);
      expect(cheapestPlanAllowing(limit)).toBe(first);
    }
  });

  it("locks plan-gated tiles without a plan, and opens them with one", () => {
    const none = { accessPlan: null, allowances: null, modules: NONE, hasCrmOrg: false };
    expect(tileAccess(def("gbp"), none)).toEqual({ entitled: false, requiredPlan: "starter" });
    expect(tileAccess(def("property"), none)).toEqual({ entitled: true });
    const starter = { accessPlan: "starter" as const, allowances: PLANS.starter.limits, modules: NONE, hasCrmOrg: true };
    expect(tileAccess(def("gbp"), starter).entitled).toBe(true);
    expect(tileAccess(def("clickGuard"), starter)).toEqual({ entitled: false, requiredPlan: "pro" });
    expect(tileAccess(def("cloudflare"), starter)).toEqual({ entitled: false, requiredPlan: "agency", module: "cloudflareSearchConsole" });
  });

  it("opens Agency modules on the Agency plan; the call assistant stays coming soon", () => {
    const agency = { accessPlan: "agency" as const, allowances: PLANS.agency.limits, modules: ALL, hasCrmOrg: true };
    expect(tileAccess(def("adsManager"), agency).entitled).toBe(true);
    expect(tileAccess(def("callAssistant"), agency)).toMatchObject({ entitled: false, comingSoon: true, addon: "call_assistant" });
  });

  it("lets a crew member without a plan of their own into the CRM tiles", () => {
    const crew = { accessPlan: null, allowances: null, modules: NONE, hasCrmOrg: true };
    expect(tileAccess(def("crm"), crew).entitled).toBe(true);
    expect(tileAccess(def("texting"), crew).entitled).toBe(false);
  });
});

describe("sample payloads", () => {
  for (const scenario of DASHBOARD_FIXTURE_SCENARIOS) {
    it(`${scenario}: every tile, in catalogue order, marked as a fixture`, () => {
      const p = buildDashboardFixture(scenario, { displayName: "Sam Rivera" }, new Date("2026-10-02T15:00:00Z"));
      expect(p.fixture).toBe(true);
      expect(p.tiles.map((t) => t.key)).toEqual([...DASHBOARD_TILE_KEYS]);
      for (const t of p.tiles) {
        expect(new Set(t.metrics.map((x) => x.key)).size).toBe(t.metrics.length);
        if (t.status === "locked") expect(t.requiredPlan && !t.entitled && t.metrics.length === 0).toBe(true);
        if (t.status === "error" || t.status === "empty") expect(t.metrics).toEqual([]);
      }
      expect(p.tiles.find((t) => t.key === "callAssistant")!.status).toBe("coming_soon");
      expect(p.account.usage.every((u) => u.limit !== 0)).toBe(true);
      expect(p.account.resetsAt).toBe("2026-11-01T00:00:00.000Z");
    });
  }

  it("full shows every status at least once", () => {
    const statuses = new Set(buildDashboardFixture("full").tiles.map((t) => t.status));
    expect([...statuses].sort()).toEqual(["coming_soon", "empty", "error", "locked", "ok"]);
  });

  it("greets by first name, or not at all", () => {
    expect(buildDashboardFixture("full", { displayName: "Sam Rivera" }).account.firstName).toBe("Sam");
    expect(buildDashboardFixture("full", {}).account.firstName).toBeNull();
  });
});
