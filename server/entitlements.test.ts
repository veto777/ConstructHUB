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
import { ADDONS, PLANS, LEGACY_PLAN_MAP, fitsLimit, SEO_GRANDFATHERED_LIMITS, SEO_PLAN_LIMITS, UNLIMITED } from "@shared/plans";
import { STANDALONE_BASE_LIMITS } from "@shared/alacarte";
import { withSeoGrandfathering, sendModuleRequired, accessPlanName, ownsAllowances } from "./entitlements";
import { seoIncluded, seoAllowanceTest } from "./seo/plan";

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
    // The one Stripe-less Platinum grant (no end date) keeps full Unlimited entitlements.
    mocks.row = customer("platinum", { stripe_subscription_id: null });
    const platinum = await getEntitlements(7);
    expect(platinum.accessPlan).toBe("agency");
    expect(platinum.modules).toEqual(PLANS.agency.modules);
    expect(Object.values(platinum.modules).every(Boolean)).toBe(true);
    // Gold is Agency ($199): every premium module, still no white label.
    mocks.row = customer("gold");
    const gold = await getEntitlements(7);
    expect(gold.modules.adsManager).toBe(true);
    expect(gold.modules.whiteLabel).toBe(false);
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
    expect(callAssistantAllowance(ent)).toEqual({ numbers: ADMIN_CALL_ASSISTANT_NUMBERS, minutes: -1, overageCentsPerMinute: 50 });
    // The gates: a location at any count fits; the agency workspace is on.
    expect(fitsLimit(ent.allowances!.locations, 10_000, 50)).toBe(true);
    expect(ent.modules.agencyWorkspace).toBe(true);
  });

  it("agency and pro customers are exactly the price book (unchanged)", async () => {
    mocks.row = customer("agency");
    const agency = await getEntitlements(7);
    expect(agency.isPlatformAdmin).toBe(false);
    expect(agency.allowances).toEqual(allowancesFor("agency"));
    expect(agency.allowances).toEqual(PLANS.agency.limits);   // Unlimited: no self-serve cap override
    expect(agency.modules).toEqual(PLANS.agency.modules);
    expect(agency.addonModules.callAssistant).toBe(false);
    expect(callAssistantAllowance(agency)).toEqual({ numbers: 0, minutes: 0, overageCentsPerMinute: 0 });

    // The AI Call Assistant is its own subscription (the call_assistant_* columns the account query joins in).
    mocks.row = customer("pro", { call_assistant_tier: "solo", call_assistant_status: "active", call_assistant_extra_numbers: 0 });
    const pro = await getEntitlements(7);
    expect(pro.isPlatformAdmin).toBe(false);
    expect(pro.allowances).toEqual(PLANS.pro.limits);
    for (const k of USAGE_CAPS) expect(pro.allowances![k], k).not.toBe(-1);
    expect(pro.modules).toEqual(PLANS.pro.modules);
    expect(callAssistantAllowance(pro)).toEqual({ numbers: 1, minutes: 1000, overageCentsPerMinute: 50 }); // the 1,000 minutes tier: the price book's
    // A full pro location count is still refused (25 used, one more does not fit).
    expect(fitsLimit(pro.allowances!.locations, 25)).toBe(false);
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

  it("applies sold add-ons and existing paid legacy locations", () => {
    // Every count add-on sells on Pro: seats, protected sites and scans all move.
    expect(allowancesFor("pro", { protected_site: 2, extra_seat: 1, competitor_pack: 1 })).toMatchObject({ protectedSites: 12, agencySeats: 6, competitorScans: 20 });
    // Extra seat is not sold on Unlimited (its seats are unlimited); Agency ($199) takes two.
    expect(allowancesFor("agency", { extra_seat: 2 })).toMatchObject({ agencySeats: PLANS.agency.limits.agencySeats });
    expect(allowancesFor("growth", { extra_seat: 2 })).toMatchObject({ agencySeats: PLANS.growth.limits.agencySeats + 2 });
    // Starter sells protected sites and competitor packs (1 and 3 included, then the add-on units).
    expect(allowancesFor("starter", { protected_site: 2, competitor_pack: 3 })).toMatchObject({ protectedSites: 3, competitorScans: 31 });
    // Retired paid locations still grant capacity; unlimited stays unlimited.
    expect(allowancesFor("growth", { extra_location: 2 }).locations).toBe(PLANS.growth.limits.locations + 2);
    expect(allowancesFor("agency", { extra_location: 5 }).locations).toBe(-1);
    expect(parseAddons({ extra_seat: 2, protected_site: -1, bogus: 3, competitor_pack: "1.5" })).toEqual({ extra_seat: 2 });
    expect(parseAddons("nonsense")).toEqual({});
  });

  it("reads purchased add-ons from the subscription row", async () => {
    mocks.row = customer("growth", { addons: { competitor_pack: 2, extra_seat: 3 } });
    const ent = await getEntitlements(7);
    expect(ent.allowances).toMatchObject({ competitorScans: 40, agencySeats: 13 });
    expect(ent.limits?.competitorScans).toBe(20);
  });

  it("lets legacy Starter use its paid second location until the holding is removed", async () => {
    mocks.row = customer("starter", { addons: { extra_location: 1 } });
    const ent = await getEntitlements(7);
    expect(ent.allowances?.locations).toBe(2);
    expect(fitsLimit(ent.allowances!.locations, 1)).toBe(true);
    expect(fitsLimit(ent.allowances!.locations, 2)).toBe(false);
    mocks.row = customer("starter", { addons: {} });
    expect((await getEntitlements(7)).allowances?.locations).toBe(1);
  });
});

describe("module helpers", () => {
  it("hasModule follows the plan (and platform-admin access)", async () => {
    mocks.row = customer("agency");
    expect(await hasModule(7, "adsManager")).toBe(true);
    // Team is below Pro: no premium modules. Agency ($199, the growth key) has them.
    mocks.row = customer("team");
    expect(await hasModule(7, "adsManager")).toBe(false);
    mocks.row = customer("growth");
    expect(await hasModule(7, "adsManager")).toBe(true);
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
    expect([...allowed].sort()).toEqual([1, 2, 5, 6]);   // 3 is past_due: paused until paid; 2 is growth (Pro-and-up module)
    expect(query.mock.calls.length - before).toBe(1);
    expect(await usersWithModule([], "adsManager")).toEqual(new Set());
  });

  it("planPausedMessage names the module and the plan that includes it", () => {
    expect(planPausedMessage("cloudflareSearchConsole")).toBe("Not run: Cloudflare + Search Console is included with the Pro plan.");
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

    // Solo includes one Competitor Intel scan; asking for more than the plan
    // carries names the first plan that carries it (Pro, 10).
    mocks.row = customer("starter");
    const starter = res();
    expect(await requirePlan(starter, 7, "Competitor Intel", (a) => a.competitorScans > 5)).toBeNull();
    expect(starter.json.mock.calls[0][0]).toMatchObject({ code: "plan_required", requiredPlan: "pro", message: "Competitor Intel is included with the Pro plan. Upgrade in Pricing to use it." });

    mocks.row = customer("premium");
    expect((await requirePlan(res(), 7, "Competitor Intel", (a) => a.competitorScans > 5))?.plan).toBe("pro");
  });

  it("names the limit and how to raise it", async () => {
    mocks.row = customer("starter");
    const starter = res();
    sendLocationLimit(starter, await getEntitlements(7), 1);
    expect(starter.status).toHaveBeenCalledWith(403);
    expect(starter.json.mock.calls[0][0]).toMatchObject({
      code: "limit_reached", feature: "locations", limit: 1, used: 1, upgradePlan: "team", addon: null,
      message: "Your Solo plan covers 1 Google Business Profile location and 1 is in use. To raise it, move to Team (10 locations).",
    });
    mocks.row = customer("growth");
    const agency = res();
    sendLocationLimit(agency, await getEntitlements(7), 100, 3);
    expect(agency.json.mock.calls[0][0].message).toBe("Your Agency plan covers 100 Google Business Profile locations and 100 are in use. You selected 3 new locations. To raise it, move to Unlimited.");

    mocks.row = customer("pro");
    const hint = raiseHint(await getEntitlements(7), "protectedSites", ["website"], "protected_site");
    expect(hint).toEqual({ text: "To raise it, add the Extra protected website add-on or move to Agency (25 websites).", upgradePlan: "growth", addon: "protected_site" });
    expect(cheapestPlanWhere((l) => l.autoPublishAiReplies)).toBe("pro");
  });
});

describe("SEO grandfathering and founding members (account_pricing_terms, owner 2026-10-08)", () => {
  const grandfathered = { seo_grandfathered_at: new Date("2026-10-08T12:00:00Z"), seo_grandfathered_plan: "starter" };

  it("a Starter sold after the change has no SEO tools, and the 402 names Agency", async () => {
    mocks.row = customer("starter");
    const ent = await getEntitlements(7);
    expect(ent.seoGrandfathered).toBe(false);
    expect(ent.foundingMember).toBeNull();
    expect(ent.allowances?.seoKeywords).toBe(0);
    expect(ent.allowances?.seoCreditCents).toBe(0);
    expect(seoIncluded(ent)).toBe(false);
    expect(cheapestPlanWhere(seoAllowanceTest)).toBe("growth");
    const r = res();
    expect(await requirePlan(r, 7, "SEO tools", seoAllowanceTest)).toBeNull();
    expect(r.status).toHaveBeenCalledWith(402);
    expect(r.json.mock.calls[0][0]).toMatchObject({ code: "plan_required", requiredPlan: "growth" });
    expect(r.json.mock.calls[0][0].message).toMatch(/Agency plan/);
  });

  it("a grandfathered Starter keeps 50 keywords and $10 of data; on Pro it keeps Pro's old numbers; a legacy key maps first", async () => {
    mocks.row = customer("starter", grandfathered);
    let ent = await getEntitlements(7);
    expect(ent.seoGrandfathered).toBe(true);
    expect(ent.allowances?.seoKeywords).toBe(50);
    expect(ent.allowances?.seoCreditCents).toBe(1000);
    expect(seoIncluded(ent)).toBe(true);
    // The published limits are untouched: only this account's allowances carry the overlay.
    expect(ent.limits?.seoKeywords).toBe(SEO_PLAN_LIMITS.starter.seoKeywords);

    mocks.row = customer("pro", grandfathered);
    ent = await getEntitlements(7);
    expect([ent.allowances?.seoKeywords, ent.allowances?.seoCreditCents]).toEqual([200, 2000]);

    mocks.row = customer("business", grandfathered); // legacy → pro
    ent = await getEntitlements(7);
    expect(ent.accessPlan).toBe("pro");
    expect([ent.allowances?.seoKeywords, ent.allowances?.seoCreditCents]).toEqual([200, 2000]);

    mocks.row = customer("growth", grandfathered);
    ent = await getEntitlements(7);
    expect([ent.allowances?.seoKeywords, ent.allowances?.seoCreditCents]).toEqual([1000, 4000]);
  });

  it("Agency has its own numbers, grandfathered or not; a platform admin stays unlimited", async () => {
    mocks.row = customer("agency", grandfathered);
    let ent = await getEntitlements(7);
    expect(ent.seoGrandfathered).toBe(true);
    expect([ent.allowances?.seoKeywords, ent.allowances?.seoCreditCents]).toEqual([5000, 6000]);
    mocks.row = customer("agency");
    ent = await getEntitlements(7);
    expect([ent.allowances?.seoKeywords, ent.allowances?.seoCreditCents]).toEqual([5000, 6000]);
    mocks.row = { email: "support@constructhub.us", plan: "starter", status: "active", stripe_subscription_id: "sub_a", ...grandfathered };
    ent = await getEntitlements(7);
    expect(ent.isPlatformAdmin).toBe(true);
    expect([ent.allowances?.seoKeywords, ent.allowances?.seoCreditCents]).toEqual([-1, -1]);
    expect(seoIncluded(ent)).toBe(true);
  });

  it("grandfathering follows the plan the account is on now — without a plan there is nothing to keep", async () => {
    for (const row of [customer("starter", { ...grandfathered, status: "canceled" }), customer("pro", { ...grandfathered, status: "past_due" }),
      customer("growth", { ...grandfathered, stripe_subscription_id: null, current_period_end: new Date("2020-01-01T00:00:00Z") })]) {
      mocks.row = row;
      const ent = await getEntitlements(7);
      expect(ent.plan).toBeNull();
      expect(ent.seoGrandfathered).toBe(false);
      expect(ent.allowances).toBeNull();
      expect(seoIncluded(ent)).toBe(false);
    }
  });

  it("the overlay only ever raises: bigger numbers and unlimited are left alone", () => {
    const base = { ...PLANS.starter.limits, seoKeywords: 5000, seoCreditCents: 9000 };
    expect(withSeoGrandfathering(base, "starter")).toMatchObject({ seoKeywords: 5000, seoCreditCents: 9000 });
    const unlimited = { ...PLANS.starter.limits, seoKeywords: -1, seoCreditCents: -1 };
    expect(withSeoGrandfathering(unlimited, "pro")).toMatchObject({ seoKeywords: -1, seoCreditCents: -1 });
    expect(withSeoGrandfathering(PLANS.growth.limits, "growth")).toMatchObject(SEO_GRANDFATHERED_LIMITS.growth);
    expect(withSeoGrandfathering(PLANS.agency.limits, "agency")).toEqual(PLANS.agency.limits);
    // Nothing else moves.
    const { seoKeywords: _k, seoCreditCents: _c, ...rest } = withSeoGrandfathering(PLANS.starter.limits, "starter");
    const { seoKeywords: _k2, seoCreditCents: _c2, ...want } = PLANS.starter.limits;
    expect(rest).toEqual(want);
  });

  it("exposes a founding member's locked prices, and reads a broken snapshot as none", async () => {
    // A 2026-10-08 snapshot (the four-plan book): every current plan key must be present or the snapshot reads as none.
    const prices = { plans: { starter: { monthlyCents: 2900, annualCents: 29000 }, team: { monthlyCents: 4900, annualCents: 49000 }, pro: { monthlyCents: 7900, annualCents: 79000 }, growth: { monthlyCents: 19900, annualCents: 199000 }, agency: { monthlyCents: 34900, annualCents: 349000 } }, agencyBands: [{ upTo: 10, centsPerLocation: 0 }], agencyIncludedLocations: 10, annualMonths: 10, capturedAt: "2026-10-08T12:00:00.000Z" };
    mocks.row = customer("pro", { founding_member_at: new Date("2026-10-08T12:00:00Z"), founding_prices: prices });
    let ent = await getEntitlements(7);
    expect(ent.foundingMember?.since.toISOString()).toBe("2026-10-08T12:00:00.000Z");
    expect(ent.foundingMember?.prices).toEqual(prices);
    mocks.row = customer("pro", { founding_member_at: new Date("2026-10-08T12:00:00Z"), founding_prices: { plans: { starter: { monthlyCents: "x" } } } });
    ent = await getEntitlements(7);
    expect(ent.foundingMember?.prices).toBeNull();
    // A founding member who let the plan lapse is still a founding member (the mark is theirs); it says nothing about SEO.
    mocks.row = customer("pro", { status: "canceled", founding_member_at: new Date("2026-10-08T12:00:00Z"), founding_prices: prices });
    ent = await getEntitlements(7);
    expect(ent.plan).toBeNull();
    expect(ent.foundingMember).not.toBeNull();
    expect(ent.seoGrandfathered).toBe(false);
  });
});

describe("à la carte items (shared/alacarte.ts, owner 2026-10-10): every tool as its own subscription", () => {
  const items = (...list: { key: string; tier?: string; quantity?: number; status?: string }[]) =>
    list.map((i) => ({ key: i.key, tier: i.tier ?? "standalone", quantity: i.quantity ?? 1, status: i.status ?? "active" }));

  it("with no plan at all, active items are the account's whole allowance and modules; plan stays null", async () => {
    mocks.row = { email: "solo@example.invalid", plan: null, status: null, alacarte_items: items({ key: "gbp", quantity: 2 }, { key: "reviews" }, { key: "permits" }, { key: "seo_basic" }) };
    const ent = await getEntitlements(7);
    expect(ent.plan).toBeNull();
    expect(ent.accessPlan).toBeNull();
    expect(ent.limits).toBeNull();
    expect(ent.alacarte.active).toEqual([{ key: "gbp", quantity: 2 }, { key: "reviews", quantity: 1 }, { key: "permits", quantity: 1 }, { key: "seo_basic", quantity: 1 }]);
    expect(ent.alacarte.paused).toEqual([]);
    expect(ent.allowances).toMatchObject({ locations: 2, reviewTemplates: 30, permitSearches: UNLIMITED, seoKeywords: 1000, seoCreditCents: 2000, autoPublishAiReplies: true, siteScans: 0, gridCredits: 0 });
    expect(ent.modules).toMatchObject({ reviewReminders: true, permitAlerts: true, adsManager: false, autoPosts: false });
    expect(seoIncluded(ent)).toBe(true);
    expect(ownsAllowances(ent)).toBe(true);
    expect(accessPlanName(ent)).toBe("à la carte");
    // The gates read the same shape: a location fits, Competitor Intel does not.
    expect(fitsLimit(ent.allowances!.locations, 1)).toBe(true);
    expect(fitsLimit(ent.allowances!.locations, 2)).toBe(false);
    const r = res();
    expect(await requirePlan(r, 7, "Competitor Intel", (a) => a.competitorScans !== 0)).toBeNull();
    expect(r.status).toHaveBeenCalledWith(402);
    expect(await requirePlan(res(), 7, "Permit search", (a) => a.permitSearches !== 0)).not.toBeNull();
    expect(await hasModule(7, "permitAlerts")).toBe(true);
    expect(await hasModule(7, "adsManager")).toBe(false);
  });

  it("on a plan, items add to the plan's allowances and switch modules on; unlimited stays unlimited", async () => {
    mocks.row = customer("starter", { addons: { competitor_pack: 1 }, alacarte_items: items({ key: "gridrank" }, { key: "ads_manager" }, { key: "site_scan", quantity: 2 }) });
    const ent = await getEntitlements(7);
    expect(ent.plan).toBe("starter");
    expect(ent.limits).toEqual(PLANS.starter.limits);
    expect(ent.allowances).toMatchObject({
      gridCredits: PLANS.starter.limits.gridCredits + 10, siteScans: PLANS.starter.limits.siteScans + 10,
      competitorScans: PLANS.starter.limits.competitorScans + 10, locations: 1,
    });
    expect(ent.modules).toMatchObject({ gridWatches: true, adsManager: true, cloudflareSearchConsole: false });
    expect(accessPlanName(ent)).toBe("Solo");
    mocks.row = customer("agency", { alacarte_items: items({ key: "site_scan" }) });
    expect((await getEntitlements(7)).allowances?.siteScans).toBe(UNLIMITED);
  });

  it("a paused item (payment needed) is shown, never granted; an ended one is nothing; a platform admin is unlimited anyway", async () => {
    mocks.row = { email: "solo@example.invalid", plan: null, status: null, alacarte_items: items({ key: "gbp", status: "past_due" }, { key: "reviews", status: "canceled" }) };
    let ent = await getEntitlements(7);
    expect(ent.alacarte.paused).toEqual(["gbp"]);
    expect(ent.alacarte.active).toEqual([]);
    expect(ent.allowances).toBeNull();
    expect(ent.modules.reviewReminders).toBe(false);
    expect(ownsAllowances(ent)).toBe(false);
    mocks.row = { email: "support@constructhub.us", plan: null, status: null, alacarte_items: items({ key: "gbp" }) };
    ent = await getEntitlements(1);
    expect(ent.isPlatformAdmin).toBe(true);
    expect(ent.allowances).toEqual(platformAdminAllowances());
    expect(ent.alacarte.active).toEqual([{ key: "gbp", quantity: 1 }]);
    // Nothing at all: the base is not even the stand-alone zeros — allowances stay null, as before.
    mocks.row = customer(null);
    ent = await getEntitlements(7);
    expect(ent.allowances).toBeNull();
    expect(ent.alacarte.active).toEqual([]);
    expect(STANDALONE_BASE_LIMITS.locations).toBe(0);
  });

  it("the account query joins the items in; the batch module query counts an item's module", async () => {
    const { pool } = await import("./db");
    const query = pool.query as any;
    mocks.row = customer("starter");
    await getEntitlements(7);
    const accountSql = query.mock.calls.map((c: any[]) => c[0]).find((sql: string) => /FROM users u/.test(sql) && /LEFT JOIN LATERAL/.test(sql));
    expect(accountSql).toMatch(/FROM alacarte_subscriptions a WHERE a\.user_id = u\.id\) AS alacarte_items/);
    query.mockImplementationOnce(async () => ({ rows: [
      { account_id: 1, email: "a@example.invalid", plan: null, status: null, alacarte_items: items({ key: "website_tools" }) },
      { account_id: 2, email: "b@example.invalid", plan: null, status: null, alacarte_items: items({ key: "website_tools", status: "past_due" }) },
      { account_id: 3, email: "c@example.invalid", plan: "starter", status: "active", stripe_subscription_id: "sub_3", alacarte_items: [] },
    ] }));
    expect([...await usersWithModule([1, 2, 3], "domainsMailAlerts")]).toEqual([1]);
  });

  it("the 402 for a plan module names the à la carte item that sells it on its own", () => {
    const r = res();
    sendModuleRequired(r, "adsManager");
    expect(r.status).toHaveBeenCalledWith(402);
    expect(r.json.mock.calls[0][0]).toMatchObject({ code: "plan_required", requiredPlan: "pro", alacarte: { key: "ads_manager", name: "Google Ads & LSA manager", href: "/pricing#alacarte" } });
    const none = res();
    sendModuleRequired(none, "whiteLabel");
    expect(none.json.mock.calls[0][0].alacarte).toBeUndefined();
  });
});
