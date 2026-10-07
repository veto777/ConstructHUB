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
  sendLocationLimit, raiseHint, cheapestPlanWhere, TOP_PLAN, hasModule, usersWithModule, planPausedMessage,
  platformAdminAllowances, ADMIN_NON_CAP_LIMITS, ADMIN_CALL_ASSISTANT_NUMBERS, callAssistantAllowance,
} from "./entitlements";
import { ADDONS, PLANS, AGENCY_SELF_SERVE_MAX_LOCATIONS, LEGACY_PLAN_MAP, fitsLimit } from "@shared/plans";

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

  it("a failed payment (past_due) pauses the plan until Stripe collects (owner, 2026-10-04)", async () => {
    mocks.row = customer("growth", { status: "past_due", addons: { competitor_pack: 1 } });
    const ent = await getEntitlements(7);
    expect(ent.plan).toBeNull();
    expect(ent.subscriptionStatus).toBe("past_due");
    const { pool } = await import("./db");
    const [sql, values] = (pool.query as any).mock.calls.at(-1);
    expect(sql).toMatch(/x\.status = ANY\(\$2::text\[\]\)/);
    expect(values[1]).toEqual(["active", "trialing"]);
  });

  it("has no plan for missing, inactive or unknown subscriptions", async () => {
    for (const row of [undefined, customer(null), customer("pro", { status: "canceled" }), customer("pro", { status: "unpaid" }),
      customer("pro", { status: "incomplete" }), customer("pro", { status: "incomplete_expired" }), customer("free"), customer("mystery")]) {
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

  it("gives platform admins every module and every usage limit unlimited, whatever plan they hold", async () => {
    mocks.row = { email: "support@constructhub.us", plan: null };
    const ent = await getEntitlements(1);
    expect(ent.isPlatformAdmin).toBe(true);
    expect(ent.plan).toBeNull();
    expect(ent.accessPlan).toBe(TOP_PLAN);
    expect(ent.limits).toEqual(PLANS[TOP_PLAN].limits);
    expect(ent.allowances).toEqual(platformAdminAllowances());
    expect(Object.values(ent.modules).every(Boolean)).toBe(true);
    expect(Object.values(ent.addonModules).every(Boolean)).toBe(true);
    // An admin on a small plan (or the Alpine account's legacy Platinum grant) is just as unlimited.
    for (const row of [customer("starter", { email: "support@constructhub.us" }), customer("platinum", { email: "alpinesidingcompany@gmail.com", stripe_subscription_id: null })]) {
      mocks.row = row;
      const admin = await getEntitlements(1);
      expect(admin.allowances).toEqual(platformAdminAllowances());
      expect(admin.allowances?.competitorScans).toBe(-1);
      expect(admin.allowances?.locations).toBe(-1);
    }
  });
});

describe("platform admin all-access matrix (admin vs agency vs pro)", () => {
  const NUMERIC = (Object.keys(PLANS.agency.limits) as (keyof typeof PLANS.agency.limits)[])
    .filter((k) => typeof PLANS.agency.limits[k] === "number");
  const USAGE_CAPS = NUMERIC.filter((k) => !(ADMIN_NON_CAP_LIMITS as readonly string[]).includes(k));

  it("covers every usage cap the owner named", () => {
    expect(USAGE_CAPS).toEqual(expect.arrayContaining([
      "locations", "gridCredits", "competitorScans", "protectedSites", "siteScans", "permitSearches",
      "agencySeats", "teamTextSegments", "reviewTemplates", "apiUnitsPerMonth",
    ]));
  });

  it("admin: every usage cap is -1, the rest are sane, every module and add-on module is on", async () => {
    mocks.row = { email: "alpinesidingcompany@gmail.com", plan: "platinum", status: "active", stripe_subscription_id: null, current_period_end: null };
    const ent = await getEntitlements(1);
    for (const k of USAGE_CAPS) expect(ent.allowances![k], k).toBe(-1);
    expect(ent.allowances!.guardCadenceMinutes).toBe(Math.min(...Object.values(PLANS).map((p) => p.limits.guardCadenceMinutes)));
    expect(ent.allowances!.apiRatePerMinute).toBe(PLANS[TOP_PLAN].limits.apiRatePerMinute);
    expect(ent.allowances!.gridCreditsPerLocation).toBe(0);
    expect(ent.allowances!.siteScansPerLocation).toBe(0);
    expect(ent.allowances!.autoPublishAiReplies).toBe(true);
    expect(Object.values(ent.modules).every(Boolean)).toBe(true);
    expect(ent.addonModules.callAssistant).toBe(true);
    expect(callAssistantAllowance(ent)).toEqual({ numbers: ADMIN_CALL_ASSISTANT_NUMBERS, minutes: -1, overageCentsPerMinute: 10 });
    // The gates: a location at any count fits; the agency workspace is on.
    expect(fitsLimit(ent.allowances!.locations, 10_000, 50)).toBe(true);
    expect(ent.modules.agencyWorkspace).toBe(true);
  });

  it("agency and pro customers are exactly the price book (unchanged)", async () => {
    mocks.row = customer("agency");
    const agency = await getEntitlements(7);
    expect(agency.isPlatformAdmin).toBe(false);
    expect(agency.allowances).toEqual(allowancesFor("agency"));
    expect(agency.allowances).toEqual({ ...PLANS.agency.limits, locations: AGENCY_SELF_SERVE_MAX_LOCATIONS });
    expect(agency.modules).toEqual(PLANS.agency.modules);
    expect(agency.addonModules.callAssistant).toBe(false);
    expect(callAssistantAllowance(agency)).toEqual({ numbers: 0, minutes: 0, overageCentsPerMinute: 0 });

    mocks.row = customer("pro", { addons: { call_assistant: 1 } });
    const pro = await getEntitlements(7);
    expect(pro.isPlatformAdmin).toBe(false);
    expect(pro.allowances).toEqual(PLANS.pro.limits);
    for (const k of USAGE_CAPS) expect(pro.allowances![k], k).not.toBe(-1);
    expect(Object.values(pro.modules).some(Boolean)).toBe(false);
    expect(callAssistantAllowance(pro)).toEqual({ numbers: 1, minutes: 5000, overageCentsPerMinute: 10 }); // Solo: the price book's tier
    // A full pro location count is still refused.
    expect(fitsLimit(pro.allowances!.locations, 1)).toBe(false);
  });
});

describe("add-ons", () => {
  it("reads ADDON_GRANTS from the price book's own grants, which match the descriptions", () => {
    for (const key of Object.keys(ADDONS) as (keyof typeof ADDONS)[]) expect(ADDON_GRANTS[key]).toBe(ADDONS[key].grants);
    expect(ADDONS.competitor_pack.description).toContain(`${ADDONS.competitor_pack.grants.competitorScans} more`);
    expect(ADDONS.extra_location.grants).toEqual({ locations: 1 });
    expect(ADDONS.extra_seat.grants).toEqual({ agencySeats: 1 });
    expect(ADDONS.protected_site.grants).toEqual({ protectedSites: 1 });
    expect(ADDONS.texting_number.grants).toEqual({});
  });

  it("applies only the add-ons the plan sells", () => {
    // Extra seat is an AGENCY add-on now (the CRM sells its own seats), so Pro ignores it.
    expect(allowancesFor("pro", { protected_site: 2, extra_seat: 1, competitor_pack: 1 })).toMatchObject({ protectedSites: 3, agencySeats: 0, competitorScans: 12 });
    expect(allowancesFor("agency", { extra_seat: 2 })).toMatchObject({ agencySeats: PLANS.agency.limits.agencySeats + 2 });
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
    expect(ent.allowances).toMatchObject({ competitorScans: 28, agencySeats: 0 });
    expect(ent.limits?.competitorScans).toBe(8);
  });
});

describe("module helpers", () => {
  it("hasModule follows the plan (and platform-admin access)", async () => {
    mocks.row = customer("agency");
    expect(await hasModule(7, "adsManager")).toBe(true);
    mocks.row = customer("growth");
    expect(await hasModule(7, "adsManager")).toBe(false);
  });

  it("usersWithModule answers a whole batch in one query, with the same rules", async () => {
    const { pool } = await import("./db");
    const query = pool.query as any;
    const future = new Date(Date.now() + 86400_000), past = new Date(Date.now() - 1000);
    query.mockImplementationOnce(async (sql: string, values: any[]) => {
      expect(sql).toMatch(/WHERE u\.id = ANY\(\$1::int\[\]\)/);
      expect(values[0]).toEqual([1, 2, 3, 4, 5, 6]);
      return { rows: [
        { account_id: 1, email: "a@example.invalid", plan: "agency", status: "active", stripe_subscription_id: "sub_1" },
        { account_id: 2, email: "b@example.invalid", plan: "growth", status: "active", stripe_subscription_id: "sub_2" },
        { account_id: 3, email: "c@example.invalid", plan: "platinum", status: "past_due", stripe_subscription_id: "sub_3" },
        { account_id: 4, email: "d@example.invalid", plan: "agency", status: "trialing", stripe_subscription_id: null, current_period_end: past },
        { account_id: 5, email: "e@example.invalid", plan: "agency", status: "trialing", stripe_subscription_id: null, current_period_end: future },
        { account_id: 6, email: "support@constructhub.us", plan: null, status: null },
      ] };
    });
    const before = query.mock.calls.length;
    const allowed = await usersWithModule([1, 2, 3, 4, 5, 6, 6, Number.NaN], "domainsMailAlerts");
    expect([...allowed].sort()).toEqual([1, 5, 6]);   // 3 is past_due: paused until paid
    expect(query.mock.calls.length - before).toBe(1);
    expect(await usersWithModule([], "adsManager")).toEqual(new Set());
  });

  it("planPausedMessage names the module and the plan that includes it", () => {
    expect(planPausedMessage("cloudflareSearchConsole")).toBe("Not run: Cloudflare + Search Console is included with the Agency plan.");
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
