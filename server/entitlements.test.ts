import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ row: undefined as any, locations: 0 }));
vi.mock("./db", () => ({
  pool: {
    query: vi.fn(async (text: string) => {
      if (/FROM users u/.test(text)) return { rows: mocks.row ? [mocks.row] : [] };
      if (/FROM business_locations/.test(text)) return { rows: [{ n: mocks.locations }] };
      return { rows: [] };
    }),
  },
  db: {},
}));
import {
  getEntitlements, activePlanKey, grantExpired, allowancesFor, parseAddons, ADDON_GRANTS, requirePlan,
  sendLocationLimit, raiseHint, cheapestPlanWhere, TOP_PLAN,
} from "./entitlements";
import { ADDONS, PLANS, AGENCY_SELF_SERVE_MAX_LOCATIONS, LEGACY_PLAN_MAP } from "@shared/plans";

const res = () => { const r: any = { status: vi.fn(() => r), json: vi.fn(() => r) }; return r; };
const customer = (plan: string | null, extra: Record<string, unknown> = {}) =>
  ({ email: "owner@example.invalid", plan, status: plan ? "active" : null, stripe_subscription_id: plan ? "sub_fixture" : null, current_period_end: null, ...extra });

beforeEach(() => { mocks.row = undefined; mocks.locations = 0; });

describe("plan resolution", () => {
  it("maps every legacy plan to the new plan's entitlements", async () => {
    for (const [legacy, now] of Object.entries(LEGACY_PLAN_MAP)) {
      mocks.row = customer(legacy);
      const ent = await getEntitlements(7);
      expect(ent.plan, legacy).toBe(now);
      expect(ent.storedPlan).toBe(legacy);
      expect(ent.allowances?.competitorScans).toBe(PLANS[now].limits.competitorScans);
    }
    // The one Stripe-less Platinum grant (no end date) keeps full Agency entitlements.
    mocks.row = customer("platinum", { stripe_subscription_id: null });
    const platinum = await getEntitlements(7);
    expect(platinum.accessPlan).toBe("agency");
    expect(platinum.modules).toEqual({ agencyWorkspace: true, adsManager: true, cloudflareSearchConsole: true, domainsMailAlerts: true });
    // Gold is Growth: no Agency modules.
    mocks.row = customer("gold");
    expect((await getEntitlements(7)).modules.adsManager).toBe(false);
  });

  it("has no plan for missing, inactive or unknown subscriptions", async () => {
    for (const row of [undefined, customer(null), customer("pro", { status: "canceled" }), customer("free"), customer("mystery")]) {
      mocks.row = row;
      const ent = await getEntitlements(7);
      expect(ent.plan).toBeNull();
      expect(ent.allowances).toBeNull();
      expect(Object.values(ent.modules).some(Boolean)).toBe(false);
    }
  });

  it("ends a Stripe-less grant (trial code) at its end date; Stripe rows follow their status", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const trial = { plan: "agency", status: "trialing", stripe_subscription_id: null, current_period_end: new Date("2026-10-01T11:59:59Z") };
    expect(grantExpired(trial, now)).toBe(true);
    expect(activePlanKey(trial, now)).toBeNull();
    expect(activePlanKey({ ...trial, current_period_end: new Date("2026-10-02T00:00:00Z") }, now)).toBe("agency");
    // Open-ended manual grant.
    expect(activePlanKey({ ...trial, current_period_end: null }, now)).toBe("agency");
    // A paid Stripe subscription is never expired by a stale period end.
    expect(activePlanKey({ ...trial, status: "active", stripe_subscription_id: "sub_1" }, now)).toBe("agency");
  });

  it("gives platform admins every module and the top plan's limits, never beyond it", async () => {
    mocks.row = { email: "support@constructhub.us", plan: null };
    const ent = await getEntitlements(1);
    expect(ent.isPlatformAdmin).toBe(true);
    expect(ent.plan).toBeNull();
    expect(ent.accessPlan).toBe(TOP_PLAN);
    expect(ent.allowances).toEqual(allowancesFor(TOP_PLAN));
    expect(Object.values(ent.modules).every(Boolean)).toBe(true);
    // An admin on a small plan still runs with the top plan's limits.
    mocks.row = customer("starter", { email: "support@constructhub.us" });
    const starterAdmin = await getEntitlements(1);
    expect(starterAdmin.plan).toBe("starter");
    expect(starterAdmin.allowances?.competitorScans).toBe(PLANS[TOP_PLAN].limits.competitorScans);
  });
});

describe("add-ons", () => {
  it("keeps ADDON_GRANTS in step with the price book's descriptions", () => {
    expect(ADDONS.competitor_pack.description).toContain(`${ADDON_GRANTS.competitor_pack.competitorScans} more`);
    expect(Object.keys(ADDON_GRANTS).sort()).toEqual(Object.keys(ADDONS).sort());
  });

  it("applies only the add-ons the plan sells", () => {
    expect(allowancesFor("pro", { protected_site: 2, extra_seat: 1, competitor_pack: 1 })).toMatchObject({ protectedSites: 3, crmSeats: 4, competitorScans: 12 });
    // Starter can't buy protected sites or competitor packs.
    expect(allowancesFor("starter", { protected_site: 2, competitor_pack: 3 })).toMatchObject({ protectedSites: 0, competitorScans: 0 });
    expect(allowancesFor("growth", { extra_location: 2 }).locations).toBe(5);
    // Agency grows by the location bands (self-serve cap), not by Extra location add-ons.
    expect(allowancesFor("agency", { extra_location: 5 }).locations).toBe(AGENCY_SELF_SERVE_MAX_LOCATIONS);
    expect(parseAddons({ extra_seat: 2, protected_site: -1, bogus: 3, competitor_pack: "1.5" })).toEqual({ extra_seat: 2 });
    expect(parseAddons("nonsense")).toEqual({});
  });

  it("reads purchased add-ons from the subscription row", async () => {
    mocks.row = customer("growth", { addons: { competitor_pack: 2, extra_seat: 3 } });
    const ent = await getEntitlements(7);
    expect(ent.allowances).toMatchObject({ competitorScans: 28, crmSeats: 13 });
    expect(ent.limits?.competitorScans).toBe(8);
  });
});

describe("gates and messages", () => {
  it("answers 401 without an account, 402 plan_required without the feature", async () => {
    const anon = res();
    expect(await requirePlan(anon, null, "Competitor Intel")).toBeNull();
    expect(anon.status).toHaveBeenCalledWith(401);

    const none = res();
    expect(await requirePlan(none, 7, "Citation campaigns")).toBeNull();
    expect(none.status).toHaveBeenCalledWith(402);
    expect(none.json.mock.calls[0][0]).toMatchObject({ code: "plan_required", requiredPlan: "starter" });

    mocks.row = customer("starter");
    const starter = res();
    expect(await requirePlan(starter, 7, "Competitor Intel", (a) => a.competitorScans > 0)).toBeNull();
    expect(starter.json.mock.calls[0][0]).toMatchObject({ code: "plan_required", requiredPlan: "pro", message: "Competitor Intel is included with the Pro plan. Upgrade in Pricing to use it." });

    mocks.row = customer("premium");
    expect((await requirePlan(res(), 7, "Competitor Intel", (a) => a.competitorScans > 0))?.plan).toBe("pro");
  });

  it("names the limit and how to raise it", async () => {
    mocks.row = customer("starter");
    const starter = res();
    sendLocationLimit(starter, await getEntitlements(7), 1);
    expect(starter.status).toHaveBeenCalledWith(403);
    expect(starter.json.mock.calls[0][0]).toMatchObject({
      code: "limit_reached", feature: "locations", limit: 1, used: 1, upgradePlan: "growth", addon: "extra_location",
      message: "Your Starter plan covers 1 Google Business Profile location and 1 is in use. To raise it, add the Extra location add-on or move to Growth (3 locations).",
    });
    mocks.row = customer("agency");
    const agency = res();
    sendLocationLimit(agency, await getEntitlements(7), 500, 3);
    expect(agency.json.mock.calls[0][0].message).toBe("Your Agency plan covers 500 Google Business Profile locations and 500 are in use. You selected 3 new locations. Above 500 locations, talk to a sales rep for a quote.");

    mocks.row = customer("pro");
    const hint = raiseHint(await getEntitlements(7), "protectedSites", ["website"], "protected_site");
    expect(hint).toEqual({ text: "To raise it, add the Extra protected website add-on or move to Growth (3 websites).", upgradePlan: "growth", addon: "protected_site" });
    expect(cheapestPlanWhere((l) => l.autoPublishAiReplies)).toBe("pro");
  });
});
