import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PLANS, planForModule } from "@shared/plans";
import * as copy from "@shared/plan-copy";
import { describeSubscription, intervalWord } from "../client/src/lib/pricing-display";
import { templateAnswer } from "./hub/presets";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const js = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const pricing = read("client/src/pages/pricing.tsx");
const legacy = pricing.slice(pricing.indexOf("  const legacyBand ="), pricing.indexOf("  const legacyPlan =")) + pricing.match(/  const legacyPlan =[^;]+;/)![0];
const buttons = pricing.slice(pricing.indexOf("  const startLabel ="), pricing.indexOf("  // Deep links"));
const choose = new Function("view", "subscription", "interval", "PLANS", "intervalWord", js(legacy + buttons) + '\nreturn { current: isCurrent("agency"), label: ctaLabel("agency") };');

describe("legacy Unlimited migration buttons", () => {
  it.each(["month", "year"])("offers an explicit migration for %s, including a stored minimum band", interval => {
    for (const agencyLocations of [10, 25]) {
      const sub = { plan: "agency", status: "active", billingInterval: "month" as const, stripeSubscriptionId: "sub_old", agencyLocations };
      expect(choose(describeSubscription(sub), sub, interval, PLANS, intervalWord)).toEqual({ current: false, label: "Move to Unlimited" });
    }
  });
  it("keeps flat Unlimited's current-plan and interval-change states", () => {
    const sub = { plan: "agency", status: "active", billingInterval: "month" as const, agencyLocations: null };
    expect(choose(describeSubscription(sub), sub, "month", PLANS, intervalWord)).toEqual({ current: true, label: "Current plan" });
    expect(choose(describeSubscription(sub), sub, "year", PLANS, intervalWord)).toEqual({ current: false, label: "Switch to yearly billing" });
  });
});

it("the sidebar uses the server's team entitlement, including members and loading states", () => {
  const source = read("client/src/components/app-sidebar.tsx");
  const code = source.slice(source.indexOf("  const planBadgeFor:"), source.indexOf("  const activeCount"));
  const badge = new Function("agencyMe", "user", "MODULE_BY_URL", "entitlements", "PLANS", "planForModule", js(code) + '\nreturn planBadgeFor("/agency");');
  for (const teamEntitled of [true, false, undefined]) {
    expect(badge({ entitled: false, teamEntitled }, { id: 1 }, { "/agency": "agencyWorkspace" }, {}, PLANS, planForModule)).toBe(teamEntitled === false ? "Team" : null);
  }
});

it("Master Class copy follows module inclusion and preserves the owner's exact benefits", () => {
  expect(templateAnswer("master-class")).toContain(`included with ${copy.planNamesWhere(p => p.modules.masterClass)}`);
  expect(PLANS.agency.features).toContain("The Master Class course ($2,499) included");
  expect(PLANS.agency.features).toContain("Two seats on every new product we launch (Call Assistant minutes excluded)");
  expect(copy).not.toHaveProperty("agencyBandsLine");
  expect(copy.pricingKnowledge()).not.toContain("($2,499)");
  expect(read("docs/pricing/PLAN-MATRIX.md")).toContain("Master Class course ($2,499)");
  expect(read("docs/pricing/PLAN-MATRIX.md")).toContain("Call Assistant minutes excluded");
  expect(read("HANDOFF.md")).toContain("scheduledReports is live and gated to Agency and above");
});

it.each([
  [{ included: true, purchases: [] }, true],
  [{ included: false, purchases: [{ moduleId: 1 }] }, true],
  [{ included: false, purchases: [] }, false],
])("the playbook client and endpoint agree for %j", async (access, allowed) => {
  const page = read("client/src/pages/google-ads-guide.tsx");
  expect(page).toContain('queryKey: ["/api/course-access"]');
  const expression = page.match(/  const hasAccess =[^;]+;/)![0];
  expect(new Function("access", "isDev", js(expression) + '\nreturn hasAccess;')(access, false)).toBe(allowed);
  const routes = read("server/routes.ts");
  const route = routes.slice(routes.indexOf('  app.get("/api/google-ads-guide/:slug"'), routes.indexOf('  app.post("/api/admin/test-email"'));
  let handler: Function = () => {};
  const app = { get: (_: string, fn: Function) => { handler = fn; } };
  const getCourseAccess = vi.fn(async () => access);
  // Inject the access resolver at the dynamic import boundary; execute the actual handler body.
  const executable = route.replace('const { getCourseAccess } = await import("./course-access");', '');
  new Function("app", "getCourseAccess", "getDevUser", "DEV_AUTH_BYPASS", "GOOGLE_ADS_GUIDE_SECTIONS", "GOOGLE_ADS_GUIDE_ORDER", js(executable))(app, getCourseAccess, () => ({ id: 42 }), false, { setup: { title: "Setup", content: "paid" } }, ["setup"]);
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
  await handler({ user: { id: 42 }, params: { slug: "setup" } }, res);
  expect(getCourseAccess).toHaveBeenCalledWith(42);
  if (allowed) expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ content: "paid" }));
  else expect(res.status).toHaveBeenCalledWith(403);
});
