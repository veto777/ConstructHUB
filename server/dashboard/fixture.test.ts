/**
 * Contract checks for the dashboard skeleton: the sample payloads match
 * shared/dashboard.ts, and tile access follows the price book.
 */
import { describe, expect, it } from "vitest";
import { DASHBOARD_GROUPS, DASHBOARD_TILES, DASHBOARD_TILE_KEYS, dashboardAttention, type DashboardAccount, type DashboardTile } from "@shared/dashboard";
import { ADDONS, PLANS, PLAN_KEYS, type AddonKey } from "@shared/plans";
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

  it("opens Agency modules on the Agency plan; the call assistant (a separate service) is locked until its own subscription runs — no plan is 'required'", () => {
    const agency = { accessPlan: "agency" as const, allowances: PLANS.agency.limits, modules: ALL, hasCrmOrg: true };
    expect(tileAccess(def("adsManager"), agency).entitled).toBe(true);
    // Launched: a plain lock naming the service, never "coming soon", and never a plan (owner, 2026-10-08: bought on its own).
    expect(tileAccess(def("callAssistant"), agency)).toEqual({ entitled: false, addon: "call_assistant" });
    expect(tileAccess(def("callAssistant"), { ...agency, addonModules: { callAssistant: false } })).toEqual({ entitled: false, addon: "call_assistant" });
    expect(tileAccess(def("callAssistant"), { accessPlan: null, allowances: null, modules: NONE, hasCrmOrg: false, addonModules: { callAssistant: true } })).toEqual({ entitled: true, addon: "call_assistant" });
    // "Coming soon" follows the price book: while an add-on is `preview`, its tile is coming soon.
    const saved = ADDONS.call_assistant.preview;
    try {
      ADDONS.call_assistant.preview = true;
      expect(tileAccess(def("callAssistant"), agency)).toEqual({ entitled: false, addon: "call_assistant", comingSoon: true });
      // A bought add-on opens whatever the flag says.
      expect(tileAccess(def("callAssistant"), { ...agency, addonModules: { callAssistant: true } })).toEqual({ entitled: true, addon: "call_assistant" });
    } finally {
      if (saved === undefined) delete ADDONS.call_assistant.preview; else ADDONS.call_assistant.preview = saved;
    }
  });

  it("opens the call assistant tile when its add-on module is on (platform admins)", () => {
    const admin = { accessPlan: "agency" as const, allowances: PLANS.agency.limits, modules: ALL, hasCrmOrg: true, addonModules: { callAssistant: true } };
    expect(tileAccess(def("callAssistant"), admin)).toEqual({ entitled: true, addon: "call_assistant" });
  });

  it("lets a crew member without a plan of their own into the CRM tiles, texting included (the org owner's plan decides it)", () => {
    const crew = { accessPlan: null, allowances: null, modules: NONE, hasCrmOrg: true };
    expect(tileAccess(def("crm"), crew).entitled).toBe(true);
    expect(tileAccess(def("texting"), crew).entitled).toBe(true);
    // Without an org, the viewer's own plan decides texting.
    const starter = { accessPlan: "starter" as const, allowances: PLANS.starter.limits, modules: NONE, hasCrmOrg: false };
    expect(tileAccess(def("texting"), starter)).toEqual({ entitled: false, requiredPlan: cheapestPlanAllowing("teamTextSegments") });
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
        if (t.status === "locked") expect((t.requiredPlan || t.addon) && !t.entitled && t.metrics.length === 0).toBeTruthy();
        if (t.status === "error" || t.status === "empty") expect(t.metrics).toEqual([]);
      }
      // The AI Call Assistant is on sale and none of the samples bought it: a plain lock, never "coming soon", and — a
      // separate service — no plan named: the way forward is its own pricing section.
      const ca = p.tiles.find((t) => t.key === "callAssistant")!;
      expect(ca).toMatchObject({ status: "locked", entitled: false, addon: "call_assistant", metrics: [], cta: { label: "See Call Assistant pricing", href: "/pricing#call-assistant" } });
      expect(ca.requiredPlan).toBeUndefined();
      expect(ca.message).toMatch(/separate service with its own subscription, from \$249\/mo/);
      expect(p.account.usage.every((u) => u.limit !== 0)).toBe(true);
      expect(p.account.resetsAt).toBe("2026-11-01T00:00:00.000Z");
    });
  }

  it("full shows every status at least once (coming_soon only while a tile's add-on is still preview)", () => {
    const statuses = new Set(buildDashboardFixture("full").tiles.map((t) => t.status));
    const previewTile = DASHBOARD_TILES.some((t) => t.gate.kind === "addon" && ADDONS[t.gate.addon as AddonKey]?.preview === true);
    expect([...statuses].sort()).toEqual([...(previewTile ? ["coming_soon"] : []), "empty", "error", "locked", "ok"]);
  });

  it("greets by first name, or not at all", () => {
    expect(buildDashboardFixture("full", { displayName: "Sam Rivera" }).account.firstName).toBe("Sam");
    expect(buildDashboardFixture("full", {}).account.firstName).toBeNull();
  });
});

describe("dashboardAttention (Needs you today)", () => {
  const now = new Date("2026-10-02T15:00:00Z");

  it("collects the warn/bad metrics of answering tiles, bad first, each linked to its page", () => {
    const p = buildDashboardFixture("full", {}, now);
    const items = dashboardAttention(p.tiles, p.account);
    const keys = items.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining([
      "reviews.unanswered", "profileGuard.pending", "clickGuard.suspicious30d", "crm.unscheduled",
      "crmLeads.followUpsDue", "crmLeads.needEstimate", "notifications",
    ]));
    // Only what the server marked: a "good" or untoned metric never shows up.
    expect(keys).not.toContain("crmLeads.newLeads7d");
    expect(keys).not.toContain("gbp.syncIssues");
    // The failing tile (social) contributes nothing.
    expect(keys.some((k) => k.startsWith("social."))).toBe(false);
    const leads = items.find((i) => i.key === "crmLeads.needEstimate")!;
    expect(leads).toMatchObject({ source: "Leads & follow-ups", value: 4, tone: "warn", href: "/crm/pipeline", surface: "portal" });
    expect(items.find((i) => i.key === "notifications")).toMatchObject({ value: p.account.unreadNotifications, href: "/settings?tab=notifications" });
  });

  it("adds meters over their limit (a full standing count is not), a past-due plan first; nothing when all is well", () => {
    const account: DashboardAccount = {
      firstName: null, displayName: null, plan: "growth", planName: "Growth", status: "past_due", isPlatformAdmin: false,
      trialEndsAt: null, renewsAt: null, resetsAt: now.toISOString(), unreadNotifications: 0,
      usage: [
        { key: "protectedSites", label: "Protected websites", used: 12, limit: 10, period: "count", href: "/google-ads" },
        { key: "locations", label: "Locations", used: 5, limit: 5, period: "count", href: "/locations" },
        { key: "searches", label: "Permit searches", used: 200, limit: 200, period: "monthly", href: "/search" },
        { key: "rankings", label: "Ranking-grid credits", used: 3, limit: -1, period: "monthly", href: "/ranking-grid" },
      ],
    };
    const items = dashboardAttention([], account);
    expect(items.map((i) => [i.key, i.tone])).toEqual([["billing", "bad"], ["usage.searches", "bad"], ["usage.protectedSites", "warn"]]);
    expect(items[2]).toMatchObject({ value: 12, limit: 10, hint: "Over your plan's limit" });
    const calm: DashboardTile[] = buildDashboardFixture("new", {}, now).tiles;
    expect(dashboardAttention(calm, { ...account, status: "active", usage: [], unreadNotifications: 0 })).toEqual([]);
  });
});
