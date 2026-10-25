import { describe, expect, it } from "vitest";
// The feature intro pages (/features, /features/<slug>): the registry is
// complete and consistent, every content file is honest about prices (no typed
// amounts — the template prices from the price book), every in-app link is a
// real route, and the server lists them (sitemap, per-route meta, admin index).
import fs from "fs";
import path from "path";
import express from "express";
import sharp from "sharp";
import type { AddressInfo } from "net";
import {
  EXTERNAL_FEATURE_PAGES, FEATURE_CATALOGUE, FEATURE_GROUPS, FEATURE_PAGES, FEATURES_PATH, READY_FEATURE_PAGES,
  featureIntroPath, featurePageByKey, featurePageBySlug, featurePagePath,
} from "@shared/feature-pages";
import { allowanceLine, allowanceValue, featurePlanGap, featurePriceSummary, singularUnit } from "@shared/feature-pages/pricing";
import { FEATURE_ICONS } from "@shared/feature-pages/types";
import { FEATURE_SCREENS } from "@shared/feature-pages/screens";
import { INTRO_VIDEO_PREFIX, featureIntroVideo, introVideoKey } from "@shared/feature-pages/intro-video";
import { VIDEO_MANIFEST, helpVideoFor } from "@shared/help/videos";
import { DASHBOARD_TILES } from "@shared/dashboard";
import { ADDONS, CALL_ASSISTANT_TIERS, PLANS, PLAN_KEYS } from "@shared/plans";
import { CRM_ADDONS, CRM_PLANS, CRM_PLAN_KEYS } from "@shared/crm-plans";
import { formatUsd } from "@shared/plan-copy";
import { ROUTE_META } from "@shared/route-meta";
import { buildSitemap, PUBLIC_ROUTES, withRouteMeta } from "./static";
import { adminFeaturePageRows, registerFeaturePageRoutes } from "./feature-pages";
import { DFY_CATALOGUE } from "@shared/dfy-pages";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "shared/feature-pages");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const kebab = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
/** Number words the caption guide bans (the "one list"/"one inbox" idiom is fine on purpose). */
const SPELLED_NUMBER = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/i;

/** The keys the template branch was asked to register (the dashboard's tiles + the platform pages). */
const EXPECTED_KEYS = [
  "gbp", "reviews", "profileGuard", "rankingGrid", "gbpContent", "social", "siteScan", "media",
  // The SEO suite (a stub: the à la carte SEO items' Compare page, shared/alacarte.ts).
  "seo",
  // No dashboard tile: sidebar tools with their own landing page (owner, 2026-10-25: every feature gets one).
  "pressReleases", "yelp",
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
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !["index.ts", "types.ts", "pricing.ts", "compare.ts", "screens.ts", "intro-video.ts"].includes(f));
    expect(files.map((f) => f.replace(/\.ts$/, "")).sort()).toEqual(FEATURE_PAGES.map((p) => p.key).sort());
    const index = read("shared/feature-pages/index.ts");
    for (const page of FEATURE_PAGES) expect(index).toContain(`import ${page.key} from "./${page.key}";`);
  });

  it("shows only real, described screenshots: every one is a captured image of a known page", async () => {
    for (const [key, screens] of Object.entries(FEATURE_SCREENS)) {
      expect(FEATURE_CATALOGUE.some((e) => e.key === key), key).toBe(true);
      for (const shot of screens) {
        expect(shot.src, key).toMatch(new RegExp(`^/feature-shots/${key}-\\d+\\.webp$`));
        expect(fs.existsSync(path.join(root, "client/public", shot.src)), shot.src).toBe(true);
        expect(shot.alt.length, shot.src).toBeGreaterThan(20);
        expect(shot.caption.length, shot.src).toBeGreaterThan(5);
        // Captions are page copy too: no prices, stats or promises (the image itself carries the sample data).
        expect(`${shot.alt} ${shot.caption}`, shot.src).not.toMatch(/\$\s?\d|testimonial|guarantee|#1\b|\b\d+%|\b\d+x\b|saves \d+ hours/i);
        // The guide's caption rule is stricter than alt's: never a number in it,
        // spelled out or not ("Four modules…", "over the last 30 days" both broke it).
        expect(shot.caption, shot.src).not.toMatch(/\d/);
        expect(shot.caption, shot.src).not.toMatch(SPELLED_NUMBER);
        expect(shot.width).toBeGreaterThan(0);
        expect(shot.height).toBeGreaterThan(0);
        // The manifest's dimensions must match the file on disk (a hand edit would cause CLS).
        const file = path.join(root, "client/public", shot.src);
        const meta = await sharp(file).metadata();
        expect(meta.width, shot.src).toBe(shot.width);
        expect(meta.height, shot.src).toBe(shot.height);
        // All screens are lazy-loaded below the fold, but keep them lean anyway.
        expect(fs.statSync(file).size, shot.src).toBeLessThanOrEqual(200 * 1024);
      }
    }
  });

  it("every ready page shows at least one screen, and no captured image is orphaned on disk", () => {
    // Reverse coverage: iterating FEATURE_SCREENS alone would let a future
    // ready page ship with no "In the App" section at all.
    for (const page of FEATURE_PAGES) {
      if (page.status !== "ready") continue;
      expect(FEATURE_SCREENS[page.key]?.length ?? 0, page.key).toBeGreaterThan(0);
    }
    const referenced = new Set(Object.values(FEATURE_SCREENS).flat().map((s) => s.src));
    const shotsDir = path.join(root, "client/public/feature-shots");
    const orphans = fs.readdirSync(shotsDir).filter((f) => f.endsWith(".webp") && !referenced.has(`/feature-shots/${f}`));
    expect(orphans).toEqual([]);
  });

  it("an intro film exists only through its uploaded manifest, under the page's intro-<slug> key", () => {
    // Owner, 2026-10-11: every feature page carries its intro video near the top. The key is the page's
    // slug (kebab case — a tutorial media key takes no capitals), and the Call Assistant's follows suit.
    expect(introVideoKey("reviews")).toBe("intro-reviews");
    expect(introVideoKey("rankingGrid")).toBe("intro-ranking-grid");
    expect(introVideoKey("callAssistant")).toBe("intro-call-assistant");
    for (const page of FEATURE_PAGES) expect(introVideoKey(page.key)).toBe(`${INTRO_VIDEO_PREFIX}${page.slug}`);
    // The page's video is the manifest's, or nothing — never a stand-in.
    for (const entry of FEATURE_CATALOGUE) {
      const video = featureIntroVideo(entry.key);
      expect(video, entry.key).toEqual(helpVideoFor(introVideoKey(entry.key)));
      if (video) expect(VIDEO_MANIFEST[introVideoKey(entry.key)], entry.key).toBeTruthy();
    }
    expect(featureIntroVideo("no-such-feature")).toBeNull();
    // The template and the hand-built Call Assistant page both mount the band; the landing page mounts the frame.
    expect(read("client/src/components/feature-landing/feature-landing.tsx")).toContain("<FeatureIntroVideo featureKey={page.key}");
    expect(read("client/src/pages/call-assistant-landing.tsx")).toContain('<FeatureIntroVideo featureKey="callAssistant"');
    expect(read("client/src/pages/landing.tsx")).toContain("<IntroVideoFrame video={film.video}");
    // No player without a video: both gate on it.
    const component = read("client/src/components/feature-landing/intro-video.tsx");
    expect(component).toMatch(/const video = featureIntroVideo\(featureKey\);\s*if \(!video\) return null;/);
    expect(read("client/src/pages/landing.tsx")).toMatch(/\{film\?\.video \? \(/);
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
    // Unlimited's siteScans is -1 (no cap) on the 2026-10-09 book; per-location figures are legacy-only.
    expect(s.rows.find((r) => r.label === PLANS.agency.name)!.value).toBe("Unlimited (fair use)");
    // The FAQ's allowance sentence is built from the same limits.
    const faq = featurePageByKey("siteScan")!.faqs.map((f) => f.a).join(" ");
    expect(faq).toContain(allowanceLine({ limit: "siteScans", perLocation: "siteScansPerLocation", unit: "Site Scans", period: "month" }));
    expect(faq).toContain(`${PLANS.growth.name} ${PLANS.growth.limits.siteScans}`);
  });

  it("modules name their only plan, allowances start at the cheapest plan that has one, add-ons say coming soon while in preview", () => {
    const cfPlans = PLAN_KEYS.filter((k) => PLANS[k].modules.cloudflareSearchConsole);
    const cf = featurePriceSummary({ kind: "module", module: "cloudflareSearchConsole" });
    // Cloudflare + Search Console starts at Pro on the 2026-10-09 ladder, so a multi-plan
    // module says "Included from…", not "<Name> plan" (the only-plan shape).
    expect(cf.headline).toBe(cfPlans.length === 1 ? `${PLANS[cfPlans[0]].name} plan` : `Included from the ${PLANS[cfPlans[0]].name} plan`);
    expect(cf.price).toBe(formatUsd(PLANS[cfPlans[0]].monthlyCents));
    // Every 2026-10-09 plan protects at least one website, so this allowance reads "Included in
    // every plan"; an allowance that starts higher (tracked keywords, Agency) names its plan.
    const guard = featurePriceSummary({ kind: "allowance", allowance: { limit: "protectedSites", unit: "websites", period: "count" } });
    expect(guard.headline).toBe("Included in every plan");
    expect(guard.rows.find((r) => r.label === PLANS.starter.name)!.included).toBe(PLANS.starter.limits.protectedSites !== 0);
    const keywords = PLAN_KEYS.find((k) => PLANS[k].limits.seoKeywords !== 0)!;
    expect(featurePriceSummary({ kind: "allowance", allowance: { limit: "seoKeywords", unit: "tracked keywords", period: "count" } }).headline)
      .toBe(`Included from the ${PLANS[keywords].name} plan`);
    // The AI Call Assistant is sold in tiers: the page shows the cheapest tier's price as "from", never one middle tier's.
    const ca = featurePriceSummary({ kind: "addon", addon: "call_assistant" });
    const cheapestTier = Math.min(...CALL_ASSISTANT_TIERS.map((t) => t.monthlyCents));
    expect(ca.comingSoon).toBe(ADDONS.call_assistant.preview === true);
    expect(ca.price).toBe(formatUsd(cheapestTier));
    expect(ca.from).toBe(true);
    for (const t of CALL_ASSISTANT_TIERS) expect(ca.priceNote).toContain(`${t.name}: ${formatUsd(t.monthlyCents)}/mo or ${formatUsd(t.annualCents)}/yr`);
    // A separate service (owner, 2026-10-08): no plan includes or sells it, and the page links its own pricing.
    expect(ca.headline).toBe("Separate service");
    expect(ca.priceNote).toContain("no ConstructHUB plan includes it, and none is needed to buy it");
    expect(ca.rows.map((r) => r.included)).toEqual(PLAN_KEYS.map(() => false));
    expect(ca.link).toEqual({ label: "See Call Assistant pricing", href: "/pricing#call-assistant" });
    // A single add-on keeps its own price.
    expect(featurePriceSummary({ kind: "addon", addon: "competitor_pack" }).price).toBe(formatUsd(ADDONS.competitor_pack.monthlyCents));
    expect(allowanceValue(PLANS.starter, { limit: "permitSearches", unit: "permit searches", period: "month" })).toBe(`${PLANS.starter.limits.permitSearches} permit searches a month`);
    expect(singularUnit("permit searches")).toBe("permit search");
    expect(singularUnit("Site Scans")).toBe("Site Scan");
    expect(singularUnit("websites")).toBe("website");
  });
});

describe("marketing truth: a page's plan claims match the gate the code enforces (reviewers, 2026-10-11)", () => {
  it("Social Media is sold as the socialPublishing module (Pro and up, or the à la carte item), never 'every plan'", () => {
    const page = featurePageByKey("social")!;
    expect(page.pricing).toMatchObject({ kind: "module", module: "socialPublishing" });
    const s = featurePriceSummary(page.pricing);
    const first = PLAN_KEYS.find((k) => PLANS[k].modules.socialPublishing)!;
    expect(s.headline).toBe(`Included from the ${PLANS[first].name} plan`);
    expect(s.plans).toEqual(PLAN_KEYS.filter((k) => PLANS[k].modules.socialPublishing));
    const text = JSON.stringify(page);
    expect(text).not.toMatch(/every plan/i);
    const faq = page.faqs.find((f) => /which plans/i.test(f.q))!;
    for (const k of PLAN_KEYS) if (PLANS[k].modules.socialPublishing) expect(faq.a).toContain(PLANS[k].name);
    expect(faq.a).toContain("Social media publishing");
    // A Solo account is told to move up, not that it already has it.
    expect(featurePlanGap(page.pricing, { accessPlan: "starter", allowances: PLANS.starter.limits, modules: PLANS.starter.modules }))
      .toEqual({ label: `Upgrade to ${PLANS[first].name}`, href: "/pricing", note: `Not in your ${PLANS.starter.name} plan.` });
  });

  it("Gabe is priced from the monthly question allowance the Hub reserves, plan by plan, with no typed daily number", () => {
    const page = featurePageByKey("gabe")!;
    expect(page.pricing).toMatchObject({ kind: "allowance", allowance: { limit: "gabeQuestions", period: "month" } });
    const s = featurePriceSummary(page.pricing);
    expect(s.rows.map((r) => r.label)).toEqual(PLAN_KEYS.map((k) => PLANS[k].name));
    expect(s.rows.find((r) => r.label === PLANS.starter.name)!.value).toBe(`${PLANS.starter.limits.gabeQuestions} questions a month`);
    expect(s.rows.find((r) => r.label === PLANS.agency.name)!.value).toBe("Unlimited (fair use)");
    const text = JSON.stringify(page);
    expect(text).not.toMatch(/isn't counted against any plan|no plan check|40 questions a day/i);
    expect(page.faqs.map((f) => f.a).join(" ")).toContain(allowanceLine({ limit: "gabeQuestions", unit: "questions", period: "month" }));
    // The quick questions stay free: the note says so, in those words.
    expect(page.pricing.note).toMatch(/quick questions are free/i);
  });

  it("Site Scan names the white-label plan wherever it promises a branded PDF", () => {
    const page = featurePageByKey("siteScan")!;
    const plan = PLANS[PLAN_KEYS.find((k) => PLANS[k].modules.whiteLabel)!].name;
    const branded = page.cards.find((c) => /company name and logo/i.test(c.body))!;
    expect(branded.body).toContain(`${plan} plan`);
    expect(page.pricing.note).toContain(plan);
    for (const line of [...page.compare!.onlyUs, ...page.audience.map((a) => a.body)]) {
      if (/brand/i.test(line)) expect(line, line).toContain(plan);
    }
  });

  it("the Customer API's rate line carries every plan's own per-minute rate", () => {
    const page = featurePageByKey("customerApi")!;
    const line = page.spotlight!.points.find((p) => /requests a minute/.test(p))!;
    const rates = new Set(PLAN_KEYS.filter((k) => PLANS[k].limits.apiUnitsPerMonth !== 0).map((k) => PLANS[k].limits.apiRatePerMinute));
    for (const rate of rates) expect(line).toContain(String(rate));
    if (rates.size > 1) expect(line).toContain(PLANS.agency.name);
  });
});

describe("the CRM is a separate product on every feature page (owner, 2026-10-07)", () => {
  it("CRM pages are priced from the cheapest CRM plan, never 'Included in every plan'", () => {
    const cheapest = Math.min(...CRM_PLAN_KEYS.map((k) => CRM_PLANS[k].monthlyCents));
    for (const key of ["crm", "crmSchedule", "crmLeads"]) {
      const page = featurePageByKey(key)!;
      expect(page.pricing.kind, key).toBe("crmPlan");
      const s = featurePriceSummary(page.pricing);
      expect(s.headline, key).not.toMatch(/included/i);
      expect(s.price).toBe(formatUsd(cheapest));
      expect(s.from).toBe(true);
      expect(s.rows.map((r) => r.label)).toEqual(CRM_PLAN_KEYS.map((k) => CRM_PLANS[k].name));
      expect(s.priceNote).toContain("separate product");
    }
  });

  it("JobCam: the figure is the add-on's price on the plans that sell it, and the including plan shows its own price", () => {
    const s = featurePriceSummary(featurePageByKey("jobcam")!.pricing);
    const includedIn = CRM_PLAN_KEYS.filter((k) => CRM_PLANS[k].limits.jobcam);
    expect(s.headline).toBe("CRM add-on");
    expect(s.price).toBe(formatUsd(CRM_ADDONS.jobcam.monthlyCents));
    for (const k of CRM_ADDONS.jobcam.availableOn) expect(s.priceTail).toContain(CRM_PLANS[k].name);
    expect(s.priceTail).toContain(`included in ${CRM_PLANS[includedIn[0]].name}`);
    for (const k of includedIn) {
      expect(s.priceTail).toContain(`${CRM_PLANS[k].name} (${formatUsd(CRM_PLANS[k].monthlyCents)}/mo)`);
      expect(s.priceNote).toContain(`${CRM_PLANS[k].name} (${formatUsd(CRM_PLANS[k].monthlyCents)}/mo)`);
    }
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
      if (as === "admin") (req as any).user = { id: 1, email: "social@constructhub.us" };
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
      .toEqual({ label: `Upgrade to ${PLANS.pro.name}`, href: "/pricing", note: `Not in your ${PLANS.starter.name} plan.` });
    // Click Guard starts at Solo now (1 protected website), so the gap case for an allowance
    // uses the agency workspace, which starts at Agency.
    expect(featurePlanGap(featurePageByKey("agency")!.pricing, ent("starter")))
      .toEqual({ label: `Upgrade to ${PLANS.growth.name}`, href: "/pricing", note: `Not in your ${PLANS.starter.name} plan.` });
    // …and Click Guard on Solo is not a gap at all.
    expect(featurePlanGap(featurePageByKey("clickGuard")!.pricing, ent("starter"))).toBeNull();
  });
  it("is null when the plan includes it, for features every plan has, and for accounts with no plan of their own", () => {
    expect(featurePlanGap(featurePageByKey("clickGuard")!.pricing, ent("pro"))).toBeNull();
    expect(featurePlanGap(featurePageByKey("cloudflare")!.pricing, ent("agency"))).toBeNull();
    expect(featurePlanGap(featurePageByKey("siteScan")!.pricing, ent("starter"))).toBeNull();
    expect(featurePlanGap(featurePageByKey("cloudflare")!.pricing, ent(null))).toBeNull();
  });
  it("sends the AI Call Assistant (a separate service) to its own pricing unless its module is on", () => {
    const spec = { kind: "addon", addon: "call_assistant" } as const;
    expect(featurePlanGap(spec, ent("pro"))).toMatchObject({ label: "See Call Assistant pricing", href: "/pricing#call-assistant" });
    expect(featurePlanGap(spec, ent("agency"))).toMatchObject({ href: "/pricing#call-assistant", note: `A separate service, not part of your ${PLANS.agency.name} plan.` });
    expect(featurePlanGap(spec, ent("pro", { addonModules: { callAssistant: true } }))).toBeNull();
  });
});
