import { describe, expect, it } from "vitest";
// Which tools the sidebar shows and which it moves to the locked "More tools" group (client/src/lib/tool-access.ts),
// and that the sidebar renders them that way. The rules mirror the server's gates on GET /api/entitlements, with the
// à la carte items already laid over the plan (shared/alacarte.ts). Pure + source guards.
import fs from "fs";
import path from "path";
import { TOOL_RULES, toolAccess, lockedLanding, lockedFeatureSlug, toolRuleFor, type ToolAccessContext } from "../client/src/lib/tool-access";
import type { EntitlementsInfo } from "../client/src/lib/pricing-display";
import { PLANS, NO_PLAN_MODULES } from "@shared/plans";
import { STANDALONE_BASE_LIMITS, applyAlacarteGrants, type AlacarteKey } from "@shared/alacarte";
import { FEATURE_PAGES } from "@shared/feature-pages";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const ent = (over: Partial<EntitlementsInfo> = {}): EntitlementsInfo => ({
  plan: null, storedPlan: null, accessPlan: null, planName: null, isPlatformAdmin: false, grantEndsAt: null,
  allowances: null, modules: { ...NO_PLAN_MODULES }, addonModules: { callAssistant: false }, addons: {},
  locations: { used: 0, limit: 0 }, usage: {}, resetsAt: "", ...over,
});
const ctx = (entitlements: EntitlementsInfo | undefined, over: Partial<ToolAccessContext> = {}): ToolAccessContext =>
  ({ entitlements, agencyMember: false, agencyWorkspace: false, crmActive: false, ...over });
const onPlan = (plan: keyof typeof PLANS) => ent({ plan, accessPlan: plan, allowances: PLANS[plan].limits, modules: PLANS[plan].modules });
const onItems = (...keys: AlacarteKey[]) => {
  const o = applyAlacarteGrants(STANDALONE_BASE_LIMITS, NO_PLAN_MODULES, keys.map((key) => ({ key, quantity: 1 })));
  return ent({ allowances: o.limits, modules: o.modules });
};
// The sidebar's tool URLs, from its source (the file imports image assets, so it is read, not imported — the help-registry test's way).
const SIDEBAR_URLS = [...read("client/src/components/app-sidebar.tsx").matchAll(/url:\s*"(\/[^"#]*)"/g)].map((m) => m[1]).filter((u) => !/^\/(pricing|features)/.test(u));

describe("tool access", () => {
  it("every rule's landing page exists, and every sidebar tool either has a rule or is free", () => {
    const slugs = new Set(FEATURE_PAGES.map((p) => p.slug));
    for (const [url, rule] of Object.entries(TOOL_RULES)) {
      const slug = lockedFeatureSlug(url);
      if (slug) expect(slugs.has(slug), `${url} → ${rule.landing}`).toBe(true);
      else expect(rule.landing, url).toBe("/call-assistant");
    }
    const free = ["/databases", "/reinstatement", "/google-ad-fraud", "/google-ads-guide", "/lsa-guide", "/lsa-leads", "/master-class"];
    for (const url of SIDEBAR_URLS) expect(!!toolRuleFor(url) || free.includes(url), url).toBe(true);
    expect(toolRuleFor("/seo/keywords")).toBe(TOOL_RULES["/seo"]);
    expect(toolRuleFor("/pricing#add-ons")).toBeUndefined();
  });

  it("no account, no items: everything with a rule is locked; a free page is not; loading is unknown", () => {
    const bare = ctx(ent());
    for (const url of Object.keys(TOOL_RULES)) expect(toolAccess(url, bare), url).toBe("locked");
    expect(toolAccess("/databases", bare)).toBe("has");
    expect(toolAccess("/lsa-leads", bare)).toBe("has");
    expect(toolAccess("/search", ctx(undefined))).toBe("unknown");
    expect(toolAccess("/agency", ctx(ent(), { agencyWorkspace: undefined }))).toBe("unknown");
    expect(toolAccess("/crm-app", ctx(ent(), { crmActive: undefined }))).toBe("unknown");
  });

  it("a plan unlocks what it includes: Solo has the Google tools and permits, not the Pro modules; Pro has them", () => {
    const solo = ctx(onPlan("starter"));
    expect(toolAccess("/locations", solo)).toBe("has");
    expect(toolAccess("/search", solo)).toBe("has");
    expect(toolAccess("/google-ads", solo)).toBe("has");
    expect(toolAccess("/ads-manager", solo)).toBe("locked");
    expect(toolAccess("/cloudflare", solo)).toBe("locked");
    expect(toolAccess("/seo", solo)).toBe("locked");
    expect(toolAccess("/call-assistant", solo)).toBe("locked");
    expect(toolAccess("/crm-app", solo)).toBe("locked");
    const pro = ctx(onPlan("pro"), { agencyWorkspace: true, crmActive: true });
    for (const url of ["/ads-manager", "/cloudflare", "/social-media", "/property", "/agency", "/crm-app"]) expect(toolAccess(url, pro), url).toBe("has");
    expect(toolAccess("/seo", pro)).toBe("locked");
    expect(toolAccess("/seo", ctx(onPlan("growth")))).toBe("has");
  });

  it("an à la carte item unlocks exactly its tool, with no plan at all", () => {
    const gbp = ctx(onItems("gbp"));
    for (const url of ["/locations", "/google-profile", "/listing-editor", "/gmb-monitor", "/gbp-content", "/photos", "/google-reviews"]) expect(toolAccess(url, gbp), url).toBe("has");
    for (const url of ["/search", "/ranking-grid", "/site-scan", "/seo", "/ads-manager", "/google-ads"]) expect(toolAccess(url, gbp), url).toBe("locked");
    expect(toolAccess("/ranking-grid", ctx(onItems("gridrank")))).toBe("has");
    expect(toolAccess("/search", ctx(onItems("permits")))).toBe("has");
    expect(toolAccess("/seo/backlinks", ctx(onItems("seo_basic")))).toBe("has");
    expect(toolAccess("/cloudflare", ctx(onItems("website_tools")))).toBe("has");
    expect(toolAccess("/domains", ctx(onItems("website_tools")))).toBe("has");
    expect(toolAccess("/vpn-shield", ctx(onItems("click_guard")))).toBe("has");
    expect(toolAccess("/competitors", ctx(onItems("competitor_intel")))).toBe("has");
    expect(toolAccess("/google-reviews", ctx(onItems("reviews")))).toBe("has");
    expect(toolAccess("/gbp-content", ctx(onItems("ai_posts")))).toBe("has");
  });

  it("never a lock the server would not enforce: admins, workspace members, a paused Call Assistant", () => {
    const admin = ctx(ent({ isPlatformAdmin: true }));
    for (const url of Object.keys(TOOL_RULES)) expect(toolAccess(url, admin), url).toBe("has");
    const member = ctx(ent(), { agencyMember: true, crmActive: false });
    expect(toolAccess("/ads-manager", member)).toBe("has");
    expect(toolAccess("/crm-app", member)).toBe("locked");
    expect(toolAccess("/call-assistant", ctx(ent({ addonModulesPaused: { callAssistant: true } })))).toBe("has");
  });

  it("a locked entry opens the landing page", () => {
    expect(lockedLanding("/ads-manager")).toBe("/features/ads-manager");
    expect(lockedLanding("/seo/keywords")).toBe("/features/seo");
    expect(lockedLanding("/databases")).toBe("/databases");
    expect(lockedFeatureSlug("/search")).toBe("permits");
    expect(lockedFeatureSlug("/call-assistant")).toBeNull();
  });
});

describe("the sidebar", () => {
  const src = read("client/src/components/app-sidebar.tsx");
  it("moves what the account lacks into a locked 'More tools' group that opens landing pages, and keeps the lists the tool shell reads", () => {
    expect(src).toContain('label: "More tools"');
    expect(src).toContain("lockedLanding(item.url)");
    expect(src).toContain("toolAccess(url, accessCtx)");
    expect(src).toContain('queryKey: ["/api/crm/billing/subscription"]');
    expect(src).toContain("agencyMe.owner !== agencyMe.actor");
    expect(src).toContain("export const APP_NAV = { permitsGroup, googleGroups, googleReviewsItem, standaloneItems, pricingGroup, shownHere };");
    // The iPhone apps: a locked entry goes to the tool (its page says it is not on the account), never a sales page.
    expect(src).toContain("url: inNativeApp() ? item.url : lockedLanding(item.url)");
    expect(src).toContain('data-testid="group-more-tools"');
  });
});
