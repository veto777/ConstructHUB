import { describe, expect, it } from "vitest";
// The feature intro pages (/features, /features/<slug>): the registry is
// complete and consistent, every content file is honest about prices (no typed
// amounts — the template prices from the price book), every in-app link is a
// real route, and the server lists them (sitemap, per-route meta, admin index).
import fs from "fs";
import path from "path";
import express from "express";
import type { AddressInfo } from "net";
import {
  EXTERNAL_FEATURE_PAGES, FEATURE_CATALOGUE, FEATURE_GROUPS, FEATURE_PAGES, FEATURES_PATH, READY_FEATURE_PAGES,
  featureIntroPath, featurePageByKey, featurePageBySlug, featurePagePath,
} from "@shared/feature-pages";
import { allowanceLine, allowanceValue, featurePlanGap, featurePriceSummary, singularUnit } from "@shared/feature-pages/pricing";
import { FEATURE_ICONS } from "@shared/feature-pages/types";
import { DASHBOARD_TILES } from "@shared/dashboard";
import { ADDONS, PLANS, PLAN_KEYS } from "@shared/plans";
import { formatUsd } from "@shared/plan-copy";
import { ROUTE_META } from "@shared/route-meta";
import { buildSitemap, PUBLIC_ROUTES, withRouteMeta } from "./static";
import { adminFeaturePageRows, registerFeaturePageRoutes } from "./feature-pages";
import { DFY_CATALOGUE } from "@shared/dfy-pages";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "shared/feature-pages");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const kebab = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** The keys the template branch was asked to register (the dashboard's tiles + the platform pages). */
const EXPECTED_KEYS = [
  "gbp", "reviews", "profileGuard", "rankingGrid", "gbpContent", "social", "siteScan", "media",
  "clickGuard", "ipTracker", "vpnShield", "cloudflare", "searchConsole", "domains", "mailAlerts",
  "permits", "property", "competitors", "adsManager", "lsaLeads",
  "crm", "crmSchedule", "crmLeads", "texting", "jobcam", "agency",
  "masterClass", "guides", "reinstatement",
  "gabe", "customerApi",
];

/** Every `<Route path="…">` in App.tsx (all routers), without params. */
const APP_ROUTES = new Set([...read("client/src/App.tsx").matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]));
const routeExists = (href: string) => {
  const p = href.split(/[?#]/)[0];
  if (APP_ROUTES.has(p)) return true;
  // "/crm/estimates/:id"-style routes match a concrete path.
  return [...APP_ROUTES].some((r) => r.includes(":") && new RegExp(`^${r.replace(/:[^/]+/g, "[^/]+")}$`).test(p));
};

describe("feature page registry", () => {
  it("registers every expected feature, each once, with a unique kebab-case slug", () => {
    expect(FEATURE_PAGES.map((p) => p.key).sort()).toEqual([...EXPECTED_KEYS].sort());
    const keys = FEATURE_CATALOGUE.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    const slugs = FEATURE_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const page of FEATURE_PAGES) {
      expect(page.slug, page.key).toBe(kebab(page.key));
      expect(page.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(featurePageBySlug(page.slug)).toBe(page);
      expect(featurePageByKey(page.key)).toBe(page);
      expect(featurePagePath(page)).toBe(`/features/${page.slug}`);
    }
    // The AI Call Assistant keeps its own page and is only listed.
    expect(EXTERNAL_FEATURE_PAGES.map((e) => e.key)).toEqual(["callAssistant"]);
    expect(featureIntroPath("callAssistant")).toBe("/call-assistant");
    expect(featurePageByKey("callAssistant")).toBeUndefined();
  });

  it("gives every feature its own content file, and every content file is registered", () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !["index.ts", "types.ts", "pricing.ts"].includes(f));
    expect(files.map((f) => f.replace(/\.ts$/, "")).sort()).toEqual(FEATURE_PAGES.map((p) => p.key).sort());
    const index = read("shared/feature-pages/index.ts");
    for (const page of FEATURE_PAGES) expect(index).toContain(`import ${page.key} from "./${page.key}";`);
  });

  it("covers every dashboard tile, in the dashboard's groups", () => {
    for (const tile of DASHBOARD_TILES) {
      const entry = FEATURE_CATALOGUE.find((e) => e.key === tile.key);
      expect(entry, tile.key).toBeDefined();
      expect(entry!.group).toBe(tile.group);
    }
    const groups = FEATURE_GROUPS.map((g) => g.key);
    for (const entry of FEATURE_CATALOGUE) expect(groups).toContain(entry.group);
    // The catalogue keeps the dashboard's order: the Call Assistant sits between texting and the agency workspace.
    const run = FEATURE_CATALOGUE.filter((e) => e.group === "run").map((e) => e.key);
    expect(run).toEqual(["crm", "crmSchedule", "crmLeads", "texting", "jobcam", "callAssistant", "agency"]);
  });

  it("links every feature to an in-app route that exists in App.tsx", () => {
    for (const entry of FEATURE_CATALOGUE) expect(routeExists(entry.app.href), `${entry.key} → ${entry.app.href}`).toBe(true);
    for (const page of FEATURE_PAGES) {
      if (page.tryIt) expect(routeExists(page.tryIt.href) || page.tryIt.href === "/free-site-scan", page.tryIt.href).toBe(true);
      if (page.legacyPath) expect(routeExists(page.legacyPath), page.legacyPath).toBe(true);
    }
    expect(routeExists("/features")).toBe(true);
    expect(routeExists("/features/site-scan")).toBe(true);
    expect(routeExists("/admin/feature-pages")).toBe(true);
  });

  it("types no $ amounts in any content file: prices come from the price book", () => {
    for (const page of FEATURE_PAGES) {
      const src = read(`shared/feature-pages/${page.key}.ts`);
      expect(src, page.key).not.toMatch(/\$\s?\d/);
      // Not even spelled out as a figure next to a currency word.
      expect(src, page.key).not.toMatch(/\b\d[\d,.]*\s?(dollars|USD)\b/i);
    }
  });

  it("cites sources that exist, and uses only known icons and related keys", () => {
    for (const page of FEATURE_PAGES) {
      expect(page.sources.length, page.key).toBeGreaterThan(0);
      for (const source of page.sources) {
        const file = source.replace(/\s*\(.*\)$/, "");
        if (file.includes("*")) continue;
        expect(fs.existsSync(path.join(root, file)), `${page.key}: ${file}`).toBe(true);
      }
      for (const card of page.cards) expect(FEATURE_ICONS).toContain(card.icon);
      for (const key of page.related) {
        expect(key).not.toBe(page.key);
        expect(FEATURE_CATALOGUE.some((e) => e.key === key), `${page.key} → ${key}`).toBe(true);
      }
    }
  });

  it("holds every ready page to the writing guide's shape", () => {
    expect(READY_FEATURE_PAGES.map((p) => p.key)).toContain("siteScan");
    for (const page of READY_FEATURE_PAGES) {
      expect(page.steps.length, page.key).toBeGreaterThanOrEqual(3);
      expect(page.steps.length, page.key).toBeLessThanOrEqual(5);
      expect(page.faqs.length, page.key).toBeGreaterThanOrEqual(3);
      expect(page.faqs.length, page.key).toBeLessThanOrEqual(5);
      expect(page.cards.length, page.key).toBeGreaterThanOrEqual(3);
      expect(page.audience.length, page.key).toBeGreaterThanOrEqual(2);
      expect(page.audience.length, page.key).toBeLessThanOrEqual(4);
      expect(page.related.length, page.key).toBeGreaterThanOrEqual(1);
      expect(page.headline.swipe.trim().length, page.key).toBeGreaterThan(0);
      expect(page.seo.title, page.key).toMatch(/\| ConstructHUB$/);
      expect(page.seo.description.length, page.key).toBeLessThanOrEqual(155);
      // No testimonials, invented numbers or promises.
      const text = JSON.stringify(page);
      expect(text, page.key).not.toMatch(/testimonial|guarantee|#1\b|\b\d+%|\b\d+x\b/i);
    }
  });

  it("never calls a live add-on 'not on sale yet' (stale preview copy)", () => {
    // Owner, 2026-10-02: the Call Assistant is live — no add-on is `preview`. Copy
    // that still says one "isn't on sale yet" is stale and misleading (the
    // crm-leads FAQ did until the 2026-10-04 audit).
    if (Object.values(ADDONS).some((a: any) => a.preview === true)) return;
    for (const page of FEATURE_PAGES) {
      const text = JSON.stringify(page);
      expect(text, page.key).not.toMatch(/isn't on sale yet|is not on sale yet|not on sale yet/i);
    }
  });

  it("an In Depth section is 2–5 paragraphs and 250–500 words (WRITING-GUIDE.md), and Site Scan has the reference one", () => {
    expect(featurePageByKey("siteScan")!.inDepth).toBeDefined();
    for (const page of FEATURE_PAGES) {
      const d = page.inDepth;
      if (!d) continue;
      expect(d.paragraphs.length, page.key).toBeGreaterThanOrEqual(2);
      expect(d.paragraphs.length, page.key).toBeLessThanOrEqual(5);
      const words = [...d.paragraphs, d.bulletsIntro ?? "", ...(d.bullets ?? [])].join(" ").split(/\s+/).filter(Boolean).length;
      expect(words, page.key).toBeGreaterThanOrEqual(250);
      expect(words, page.key).toBeLessThanOrEqual(500);
      expect(d.heading.title.trim().length, page.key).toBeGreaterThan(0);
    }
  });
});

describe("feature page prices", () => {
  it("computes every page's price block from the price book, with no gaps", () => {
    for (const entry of FEATURE_CATALOGUE) {
      const s = featurePriceSummary(entry.pricing);
      const text = JSON.stringify(s);
      expect(text, entry.key).not.toMatch(/undefined|NaN|null per|\$0\b/);
      expect(s.headline.length).toBeGreaterThan(0);
      if (s.price) expect(s.price).toMatch(/^\$[\d,]+(\.\d\d)?$|^Talk to a sales rep$/);
    }
  });

  it("Site Scan: every plan, cheapest price, plan-by-plan allowance", () => {
    const s = featurePriceSummary(featurePageByKey("siteScan")!.pricing);
    const cheapest = PLAN_KEYS.reduce((a, b) => (PLANS[b].monthlyCents < PLANS[a].monthlyCents ? b : a));
    expect(s.headline).toBe("Included in every plan");
    expect(s.price).toBe(formatUsd(PLANS[cheapest].monthlyCents));
    expect(s.rows.map((r) => r.label)).toEqual(PLAN_KEYS.map((k) => PLANS[k].name));
    expect(s.rows.find((r) => r.label === PLANS.starter.name)!.value).toBe(`${PLANS.starter.limits.siteScans} Site Scans a month`);
    expect(s.rows.find((r) => r.label === PLANS.agency.name)!.value).toBe(`${PLANS.agency.limits.siteScansPerLocation} Site Scan per location a month`);
    // The FAQ's allowance sentence is built from the same limits.
    const faq = featurePageByKey("siteScan")!.faqs.map((f) => f.a).join(" ");
    expect(faq).toContain(allowanceLine({ limit: "siteScans", perLocation: "siteScansPerLocation", unit: "Site Scans", period: "month" }));
    expect(faq).toContain(`${PLANS.growth.name} ${PLANS.growth.limits.siteScans}`);
  });

  it("modules name their only plan, allowances start at the cheapest plan that has one, add-ons say coming soon while in preview", () => {
    const cf = featurePriceSummary({ kind: "module", module: "cloudflareSearchConsole" });
    expect(cf.headline).toBe(`${PLANS.agency.name} plan`);
    expect(cf.price).toBe(formatUsd(PLANS.agency.monthlyCents));
    const guard = featurePriceSummary({ kind: "allowance", allowance: { limit: "protectedSites", unit: "websites", period: "count" } });
    const first = PLAN_KEYS.find((k) => PLANS[k].limits.protectedSites !== 0)!;
    expect(guard.headline).toBe(`Included from the ${PLANS[first].name} plan`);
    expect(guard.rows.find((r) => r.label === PLANS.starter.name)!.included).toBe(PLANS.starter.limits.protectedSites !== 0);
    const ca = featurePriceSummary({ kind: "addon", addon: "call_assistant" });
    expect(ca.comingSoon).toBe(ADDONS.call_assistant.preview === true);
    expect(ca.price).toBe(formatUsd(ADDONS.call_assistant.monthlyCents));
    expect(allowanceValue(PLANS.starter, { limit: "permitSearches", unit: "permit searches", period: "month" })).toBe(`${PLANS.starter.limits.permitSearches} permit searches a month`);
    expect(singularUnit("permit searches")).toBe("permit search");
    expect(singularUnit("Site Scans")).toBe("Site Scan");
    expect(singularUnit("websites")).toBe("website");
  });
});

describe("feature pages on the server", () => {
  const indexHtml = read("client/index.html");

  it("lists /features and ready pages in the sitemap, never a stub", () => {
    const sitemap = buildSitemap();
    expect(PUBLIC_ROUTES).toContain(FEATURES_PATH);
    expect(sitemap).toContain(`${FEATURES_PATH}</loc>`);
    for (const page of FEATURE_PAGES) {
      const loc = `${featurePagePath(page)}</loc>`;
      if (page.status === "ready") expect(sitemap, page.key).toContain(loc);
      else expect(sitemap, page.key).not.toContain(loc);
    }
  });

  it("serves every feature page with its own title and description", () => {
    for (const p of [FEATURES_PATH, ...FEATURE_PAGES.map(featurePagePath)]) {
      const meta = ROUTE_META[p];
      expect(meta, p).toBeDefined();
      const html = withRouteMeta(indexHtml, p);
      expect(html).toContain(`<title>${meta.title.replace(/&/g, "&amp;")}</title>`);
    }
    expect(ROUTE_META["/features/site-scan"].title).toBe(featurePageByKey("siteScan")!.seo.title);
  });

  it("the admin index lists every page plus /call-assistant, the done-for-you services and the home landing", () => {
    const { pages, counts, catalogue } = adminFeaturePageRows();
    expect(catalogue).toBe("/features");
    expect(pages.length).toBe(FEATURE_CATALOGUE.length + DFY_CATALOGUE.length + 1);
    expect(pages.find((r) => r.key === "callAssistant")).toMatchObject({ path: "/call-assistant", status: "external" });
    expect(pages.find((r) => r.key === "landing")).toMatchObject({ path: "/landing", status: "page" });
    expect(pages.find((r) => r.key === "siteScan")).toMatchObject({ path: "/features/site-scan", status: "ready" });
    expect(counts.ready + counts.stub).toBe(FEATURE_PAGES.length);
  });

  it("GET /api/admin/feature-pages: 401 signed out, 403 for a non-admin, the list for a platform admin", async () => {
    const app = express();
    app.use((req, _res, next) => {
      const as = req.headers["x-test-user"];
      if (as === "admin") (req as any).user = { id: 1, email: "alpinesidingcompany@gmail.com" };
      if (as === "member") (req as any).user = { id: 2, email: "someone@example.com" };
      next();
    });
    registerFeaturePageRoutes(app);
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/feature-pages`;
      expect((await fetch(base)).status).toBe(401);
      expect((await fetch(base, { headers: { "x-test-user": "member" } })).status).toBe(403);
      const ok = await fetch(base, { headers: { "x-test-user": "admin" } });
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toContain("no-store");
      const body = await ok.json();
      expect(body.pages.length).toBe(FEATURE_CATALOGUE.length + DFY_CATALOGUE.length + 1);
    } finally {
      server.close();
    }
  });
});

describe("featurePlanGap: signed-in CTA for an account whose plan lacks the feature", () => {
  const ent = (plan: keyof typeof PLANS | null, extra: Partial<Parameters<typeof featurePlanGap>[1]> = {}) => ({
    accessPlan: plan, allowances: plan ? PLANS[plan].limits : null, modules: plan ? PLANS[plan].modules : {}, ...extra,
  });
  it("offers the cheapest plan that has a module or an allowance, and says the current plan lacks it", () => {
    expect(featurePlanGap(featurePageByKey("cloudflare")!.pricing, ent("starter")))
      .toEqual({ label: "Upgrade to Agency", href: "/pricing", note: "Not in your Starter plan." });
    expect(featurePlanGap(featurePageByKey("clickGuard")!.pricing, ent("starter")))
      .toEqual({ label: "Upgrade to Pro", href: "/pricing", note: "Not in your Starter plan." });
  });
  it("is null when the plan includes it, for features every plan has, and for accounts with no plan of their own", () => {
    expect(featurePlanGap(featurePageByKey("clickGuard")!.pricing, ent("pro"))).toBeNull();
    expect(featurePlanGap(featurePageByKey("cloudflare")!.pricing, ent("agency"))).toBeNull();
    expect(featurePlanGap(featurePageByKey("siteScan")!.pricing, ent("starter"))).toBeNull();
    expect(featurePlanGap(featurePageByKey("cloudflare")!.pricing, ent(null))).toBeNull();
  });
  it("sends an add-on to the add-ons list unless its module is on", () => {
    const spec = { kind: "addon", addon: "call_assistant" } as const;
    expect(featurePlanGap(spec, ent("pro"))).toMatchObject({ label: "See add-ons", href: "/pricing#add-ons" });
    expect(featurePlanGap(spec, ent("pro", { addonModules: { callAssistant: true } }))).toBeNull();
  });
});
