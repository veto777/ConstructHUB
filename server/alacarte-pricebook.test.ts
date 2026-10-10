import { describe, expect, it } from "vitest";
// The à la carte price book (shared/alacarte.ts): every tool as its own subscription, a standalone and an
// add-on price, annual = 11 × monthly, overlapping add-ons reused (never a parallel product), and the grants
// an active item lays over an account's allowances. Pure — no Stripe, no DB.
import {
  ALACARTE, ALACARTE_KEYS, ALACARTE_ANNUAL_MONTHS, ALACARTE_LINKED, ALACARTE_ADDON_ONLY, STANDALONE_BASE_LIMITS, STANDALONE_BASE_MODULES,
  alacarteMonthlyCents, alacartePriceCents, alacarteAnnualSavingsCents, isAddonPrice, alacarteTierFor, applyAlacarteGrants,
  alacarteAlreadyCovered, alacarteItemForModule, alacarteItemsForSlug, isAlacarteKey, isAlacarteTier,
} from "@shared/alacarte";
import { ADDONS, ANNUAL_MONTHS, PLANS, UNLIMITED, NO_PLAN_MODULES, COMING_MODULES, CALL_ASSISTANT_FROM_CENTS } from "@shared/plans";
import { CRM_ADDONS, CRM_PLANS } from "@shared/crm-plans";
import { FEATURE_PAGES, EXTERNAL_FEATURE_PAGES } from "@shared/feature-pages";
import { allowancesFor } from "./entitlements";

describe("the à la carte price book", () => {
  it("lists the owner's fifteen tools at the proposal-v2 prices (standalone / add-on, cents a month)", () => {
    const book = Object.fromEntries(ALACARTE_KEYS.map((k) => [k, [ALACARTE[k].standaloneMonthlyCents, alacarteMonthlyCents(k, "addon")]]));
    expect(book).toEqual({
      gbp: [3900, 2400], reviews: [5900, 3900], gridrank: [4900, 2900], competitor_intel: [2900, 1900], site_scan: [2900, 1900],
      ai_posts: [3900, 2400], ads_manager: [12900, 7900],
      // Overlaps an existing add-on: the add-on tier is that add-on's price (brief: never a parallel product).
      click_guard: [6900, 3900],
      seo_basic: [5900, ADDONS.seo_basic.monthlyCents], seo_pro: [12900, ADDONS.seo_pro.monthlyCents],
      website_tools: [5900, 3900], social: [4900, 2900], permits: [19900, 12900], jobcam: [5900, CRM_ADDONS.jobcam.monthlyCents], master_class: [9900, 4900],
    });
    expect(ALACARTE.seo_basic.addonMonthlyCents).toBe(2900);
    expect(ALACARTE.seo_pro.addonMonthlyCents).toBe(7900);
    // The add-on price is always the discount.
    for (const k of ALACARTE_KEYS) expect(alacarteMonthlyCents(k, "addon"), k).toBeLessThan(alacarteMonthlyCents(k, "standalone"));
    // No plan price moved.
    expect([PLANS.starter.monthlyCents, PLANS.team.monthlyCents, PLANS.pro.monthlyCents, PLANS.growth.monthlyCents, PLANS.agency.monthlyCents]).toEqual([2900, 4900, 9900, 19900, 44900]);
  });

  it("annual is 11 × monthly (one month free), the platform rule; an overlapping add-on keeps its own yearly price", () => {
    expect(ALACARTE_ANNUAL_MONTHS).toBe(ANNUAL_MONTHS);
    expect(ALACARTE_ANNUAL_MONTHS).toBe(11);
    for (const k of ALACARTE_KEYS) {
      expect(alacartePriceCents(k, "standalone", "year"), k).toBe(ALACARTE[k].standaloneMonthlyCents * 11);
      expect(alacartePriceCents(k, "standalone", "month"), k).toBe(ALACARTE[k].standaloneMonthlyCents);
      expect(alacarteAnnualSavingsCents(k, "standalone"), k).toBe(ALACARTE[k].standaloneMonthlyCents);
    }
    expect(alacartePriceCents("gbp", "addon", "year")).toBe(2400 * 11);
    expect(alacartePriceCents("seo_basic", "addon", "year")).toBe(ADDONS.seo_basic.annualCents);
    expect(alacartePriceCents("seo_pro", "addon", "year")).toBe(ADDONS.seo_pro.annualCents);
    expect(alacartePriceCents("click_guard", "addon", "year")).toBe(ADDONS.protected_site.annualCents);
    // Owner, 2026-10-10: the protected website is $39/mo either way (the add-on and the à la carte add-on tier agree).
    expect(ADDONS.protected_site.monthlyCents).toBe(3900);
    expect(ADDONS.protected_site.annualCents).toBe(42900);
    // Owner, 2026-10-10: the protected website is $39/mo either way (the add-on and the à la carte add-on tier agree).
    expect(ADDONS.protected_site.monthlyCents).toBe(3900);
    expect(ADDONS.protected_site.annualCents).toBe(42900);
  });

  it("the add-on price applies to any account with an active Business Tools plan or CRM plan; standalone otherwise", () => {
    expect(isAddonPrice({ plan: null, crmPlan: null })).toBe(false);
    expect(isAddonPrice({ plan: undefined, crmPlan: undefined })).toBe(false);
    expect(isAddonPrice({ plan: "starter", crmPlan: null })).toBe(true);
    expect(isAddonPrice({ plan: null, crmPlan: "crm_basic" })).toBe(true);
    expect(alacarteTierFor({ plan: null, crmPlan: null })).toBe("standalone");
    expect(alacarteTierFor({ plan: "pro", crmPlan: "crm_max" })).toBe("addon");
  });

  it("overlapping items reuse the existing add-on's key and grants, and the two SEO suites are one-per-account", () => {
    expect(ALACARTE.seo_basic.existingAddon).toBe("seo_basic");
    expect(ALACARTE.seo_basic.grants.limits).toEqual(ADDONS.seo_basic.grants);
    expect(ALACARTE.seo_pro.grants.limits).toEqual(ADDONS.seo_pro.grants);
    expect(ALACARTE.click_guard.existingAddon).toBe("protected_site");
    expect(ALACARTE.click_guard.grants.limits).toEqual({ protectedSites: 1 });
    expect(ALACARTE.seo_basic.exclusiveGroup).toBe("seo");
    expect(ALACARTE.seo_pro.exclusiveGroup).toBe("seo");
    // Per-unit items.
    expect(ALACARTE.gbp.unit).toBe("location");
    expect(ALACARTE.click_guard.unit).toBe("website");
  });

  it("grants: the table's modules and limits, read by key", () => {
    expect(ALACARTE.gbp.grants).toEqual({ limits: { locations: 1, reviewTemplates: 5 } });
    expect(ALACARTE.reviews.grants).toEqual({ modules: ["reviewReminders"], autoPublishAiReplies: true, limits: { reviewTemplates: 20 } });
    expect(ALACARTE.gridrank.grants).toEqual({ modules: ["gridWatches"], limits: { gridCredits: 10 } });
    expect(ALACARTE.competitor_intel.grants).toEqual({ limits: { competitorScans: 5 } });
    expect(ALACARTE.site_scan.grants).toEqual({ limits: { siteScans: 5 } });
    expect(ALACARTE.ai_posts.grants).toEqual({ modules: ["autoPosts"] });
    expect(ALACARTE.ads_manager.grants).toEqual({ modules: ["adsManager"] });
    expect(ALACARTE.website_tools.grants).toEqual({ modules: ["cloudflareSearchConsole", "domainsMailAlerts"] });
    expect(ALACARTE.social.grants).toEqual({ modules: ["socialPublishing"] });
    expect(ALACARTE.permits.grants).toEqual({ modules: ["permitAlerts"], limits: { permitSearches: UNLIMITED } });
    expect(ALACARTE.jobcam.grants).toEqual({ crmJobcam: true });
    expect(ALACARTE.master_class.grants).toEqual({ modules: ["masterClass"] });
    // Permit alerts are being built: the card says so while the module is in COMING_MODULES.
    expect(!!ALACARTE.permits.comingPart).toBe(COMING_MODULES.includes("permitAlerts"));
    // JobCam stands alone (owner, 2026-10-10): with no CRM plan the purchase grants the CRM's JobCam shell
    // (server/crm/entitlements.ts jobcamOnly); nothing in the price book ties it to a CRM plan.
    expect("requiresCrmPlan" in ALACARTE.jobcam).toBe(false);
  });

  it("lays active items over a stand-alone account (no plan) and over a plan's allowances, only ever raising", () => {
    const none = applyAlacarteGrants(STANDALONE_BASE_LIMITS, STANDALONE_BASE_MODULES, []);
    expect(none.limits).toEqual(STANDALONE_BASE_LIMITS);
    expect(none.modules).toEqual(NO_PLAN_MODULES);
    expect(Object.values(none.modules).some(Boolean)).toBe(false);
    const solo = applyAlacarteGrants(STANDALONE_BASE_LIMITS, STANDALONE_BASE_MODULES, [
      { key: "gbp", quantity: 2 }, { key: "reviews", quantity: 1 }, { key: "permits", quantity: 1 }, { key: "seo_basic", quantity: 1 },
    ]);
    expect(solo.limits).toMatchObject({ locations: 2, reviewTemplates: 30, permitSearches: UNLIMITED, seoKeywords: 1000, seoCreditCents: 2000, autoPublishAiReplies: true, gridCredits: 0 });
    expect(solo.modules).toMatchObject({ reviewReminders: true, permitAlerts: true, adsManager: false });
    // On a plan: Solo + GridRank adds 10 credits and the watches module; Unlimited's unlimited stays unlimited.
    const onSolo = applyAlacarteGrants(allowancesFor("starter"), PLANS.starter.modules, [{ key: "gridrank", quantity: 1 }]);
    expect(onSolo.limits.gridCredits).toBe(PLANS.starter.limits.gridCredits + 10);
    expect(onSolo.modules.gridWatches).toBe(true);
    const onTop = applyAlacarteGrants(allowancesFor("agency"), PLANS.agency.modules, [{ key: "permits", quantity: 1 }, { key: "site_scan", quantity: 3 }]);
    expect(onTop.limits.permitSearches).toBe(UNLIMITED);
    expect(onTop.limits.siteScans).toBe(UNLIMITED);
    // A quantity below one counts as one; an unknown key is ignored.
    expect(applyAlacarteGrants(STANDALONE_BASE_LIMITS, STANDALONE_BASE_MODULES, [{ key: "gbp", quantity: 0 }, { key: "bogus" as any, quantity: 1 }]).limits.locations).toBe(1);
  });

  it("never sells what the account already has", () => {
    const have = (plan: keyof typeof PLANS, extra: Partial<Parameters<typeof alacarteAlreadyCovered>[1]> = {}) =>
      ({ modules: PLANS[plan].modules, allowances: allowancesFor(plan), addons: {}, alacarte: [], ...extra });
    // Pro includes the Ads & LSA manager and automatic replies + reminders: nothing to add.
    expect(alacarteAlreadyCovered("ads_manager", have("pro"))).toBe(true);
    expect(alacarteAlreadyCovered("reviews", have("pro"))).toBe(true);
    // Solo lacks both; Team has reminders but not automatic publishing. An item sold for its modules is covered
    // once the plan has them (its count is a bonus); Agency has grid watches, so GridRank adds nothing there.
    expect(alacarteAlreadyCovered("ads_manager", have("starter"))).toBe(false);
    expect(alacarteAlreadyCovered("reviews", have("team"))).toBe(false);
    expect(alacarteAlreadyCovered("gridrank", have("pro"))).toBe(false);
    expect(alacarteAlreadyCovered("gridrank", have("growth"))).toBe(true);
    // A countable item adds to any finite number; only unlimited leaves nothing to add.
    expect(alacarteAlreadyCovered("site_scan", have("growth"))).toBe(false);
    expect(alacarteAlreadyCovered("site_scan", have("agency"))).toBe(true);
    expect(alacarteAlreadyCovered("gbp", have("agency"))).toBe(true);
    expect(alacarteAlreadyCovered("gbp", have("pro"))).toBe(false);
    // Held already, as the platform add-on or as the item, or the other suite.
    expect(alacarteAlreadyCovered("seo_basic", have("starter", { addons: { seo_basic: 1 } }))).toBe(true);
    expect(alacarteAlreadyCovered("seo_basic", have("starter", { alacarte: ["seo_pro"] }))).toBe(true);
    expect(alacarteAlreadyCovered("gridrank", have("starter", { alacarte: ["gridrank"] }))).toBe(true);
    expect(alacarteAlreadyCovered("seo_basic", have("starter"))).toBe(false);
    // No plan at all: nothing is covered.
    const bare = { modules: NO_PLAN_MODULES, allowances: null, addons: {}, alacarte: [] as any[] };
    for (const k of ALACARTE_KEYS) expect(alacarteAlreadyCovered(k, bare), k).toBe(false);
  });

  it("links the CRM and the Call Assistant to their own cards and lists the texting number as add-on only", () => {
    expect(ALACARTE_LINKED.map((l) => [l.key, l.href, l.fromMonthlyCents])).toEqual([
      ["crm", "/pricing#crm", CRM_PLANS.crm_basic.monthlyCents],
      ["call_assistant", "/pricing#call-assistant", CALL_ASSISTANT_FROM_CENTS],
    ]);
    expect(ALACARTE_ADDON_ONLY).toEqual([{ addon: "texting_number", name: ADDONS.texting_number.name, pitch: ADDONS.texting_number.description, slug: "texting" }]);
    expect(ADDONS.texting_number.monthlyCents).toBe(2900);
    expect(ADDONS.texting_number.setupCents).toBe(2900);
  });

  it("every item's Compare page exists, and the helpers find items by module and slug", () => {
    const slugs = new Set([...FEATURE_PAGES.map((p) => p.slug), ...EXTERNAL_FEATURE_PAGES.map((e) => e.path.slice(1))]);
    for (const k of ALACARTE_KEYS) expect(slugs.has(ALACARTE[k].slug), `${k} → /features/${ALACARTE[k].slug}`).toBe(true);
    for (const l of ALACARTE_LINKED) expect(slugs.has(l.slug), l.key).toBe(true);
    for (const a of ALACARTE_ADDON_ONLY) expect(slugs.has(a.slug), a.addon).toBe(true);
    expect(alacarteItemForModule("adsManager")).toBe("ads_manager");
    expect(alacarteItemForModule("domainsMailAlerts")).toBe("website_tools");
    expect(alacarteItemForModule("whiteLabel")).toBeNull();
    expect(alacarteItemsForSlug("seo").map((i) => i.key)).toEqual(["seo_basic", "seo_pro"]);
    expect(alacarteItemsForSlug("nothing")).toEqual([]);
    expect(isAlacarteKey("gbp") && isAlacarteKey("permits")).toBe(true);
    expect(isAlacarteKey("call_assistant")).toBe(false);
    expect(isAlacarteTier("addon") && isAlacarteTier("standalone") && !isAlacarteTier("free")).toBe(true);
    // No pitch types a price; every pitch is one line.
    for (const k of ALACARTE_KEYS) {
      expect(ALACARTE[k].pitch, k).not.toMatch(/\$\s?\d/);
      expect(ALACARTE[k].pitch, k).not.toMatch(/SignalWire/);
      expect(ALACARTE[k].pitch.length, k).toBeLessThan(220);
    }
  });
});
