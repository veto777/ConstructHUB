import { describe, expect, it } from "vitest";
// The "on its own" sections of the feature pages (shared/feature-pages/<key>.ts `offer`): what you get, the
// à la carte Buy / Included block, and NOT ONE other company named anywhere on the site (owner, 2026-10-10:
// "Don't list other companies on our site, we don't want to give them any SEO juice").
import fs from "fs";
import path from "path";
import { FEATURE_PAGES, featurePageByKey } from "@shared/feature-pages";
import type { FeatureOffer } from "@shared/feature-pages/types";
import { ALACARTE, ALACARTE_KEYS, isAlacarteKey } from "@shared/alacarte";
import { offerLine } from "../client/src/components/feature-landing/alacarte-offer";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const offerOf = (key: string): FeatureOffer => { const o = featurePageByKey(key)!.offer; expect(o, key).toBeDefined(); return o!; };

/** Vendors the old Compare section named, plus the usual suspects: none may appear on a public page.
 *  (Blotato is not listed: it is the posting service a Social Media buyer must sign up with, so the page has to say so.) */
const OTHER_COMPANIES = [
  "Localo", "BrightLocal", "Synup", "Local Falcon", "NiceJob", "GatherUp", "Grade.us", "Whitespark", "GMB Briefcase",
  "GMB Everywhere", "Screaming Frog", "SE Ranking", "OneUp", "Merchynt", "LeadUp", "Olly Olly", "Adalysis", "ClickCease",
  "ClickGUARD", "Fraud Blocker", "Semrush", "Ahrefs", "UptimeRobot", "AgencyAnalytics", "Marky", "SocialPilot",
  "Buffer", "Vista Social", "Shovels", "Construction Monitor", "PropStream", "CompanyCam", "Fieldwire", "Contractor Foreman",
  "Raken", "OpenPhone", "Jobber", "Broadly", "Podium", "Hatch", "Birdeye", "Contractor University", "Contractor Nation",
  "The Contractor Fight", "Breakthrough Academy", "SignalWire", "Capterra", "Housecall", "ServiceTitan", "Yext", "Moz",
];

describe("no other company is named on the site", () => {
  const contentFiles = [
    ...fs.readdirSync(path.join(root, "shared/feature-pages")).filter((f) => f.endsWith(".ts")).map((f) => `shared/feature-pages/${f}`),
    ...fs.readdirSync(path.join(root, "shared/dfy-pages")).filter((f) => f.endsWith(".ts")).map((f) => `shared/dfy-pages/${f}`),
    "client/src/pages/landing.tsx", "client/src/pages/features.tsx", "client/src/pages/pricing.tsx", "client/src/pages/done-for-you.tsx",
    "client/src/components/feature-landing/sections.tsx", "client/src/components/feature-landing/feature-landing.tsx",
    "client/src/components/feature-landing/dfy-landing.tsx", "client/src/components/feature-landing/alacarte-offer.tsx",
  ];

  it("names no competitor, vendor or product in any public content file, and links to none", () => {
    for (const file of contentFiles) {
      const src = read(file);
      for (const name of OTHER_COMPANIES) expect(src, `${file} names ${name}`).not.toMatch(new RegExp(`\\b${name.replace(/[.]/g, "\\.")}\\b`));
      expect(src, `${file} carries a vendor link`).not.toMatch(/source: "https?:\/\//);
      expect(src, `${file} still compares`).not.toMatch(/competitorPriceLabel|comparePricesNote|checkedOn|theyNotUs|noContractorAlternative/);
    }
    expect(fs.existsSync(path.join(root, "shared/feature-pages/compare.ts"))).toBe(false);
  });

  it("the template has no Compare band: the section is the feature on its own", () => {
    const sections = read("client/src/components/feature-landing/sections.tsx");
    expect(sections).toContain("export function OfferSection");
    expect(sections).not.toContain("CompareSection");
    expect(sections).not.toMatch(/What they do that we don't|List price|Compared/);
    const landing = read("client/src/components/feature-landing/feature-landing.tsx");
    expect(landing).toContain("<OfferSection");
    expect(landing).toContain("buy={<AlacarteOffer keys={page.offer.alacarte} price={price} slug={page.slug} signedIn={!!user} />}");
  });
});

describe("every offer section", () => {
  const withOffer = FEATURE_PAGES.filter((p) => p.offer);
  it("exists on each page that sells an item (and the shared ones), with what you get and valid items", () => {
    const keys = withOffer.map((p) => p.key).sort();
    expect(keys).toEqual(["adsManager", "clickGuard", "cloudflare", "competitors", "domains", "gbp", "gbpContent", "ipTracker", "jobcam", "mailAlerts", "masterClass", "permits", "profileGuard", "rankingGrid", "reviews", "searchConsole", "seo", "siteScan", "social", "texting", "vpnShield"]);
    for (const p of withOffer) {
      const o = p.offer!;
      expect(o.highlights.length, p.key).toBeGreaterThanOrEqual(3);
      for (const line of o.highlights) for (const name of OTHER_COMPANIES) expect(line, `${p.key}: ${line}`).not.toContain(name);
      for (const k of o.alacarte) expect(isAlacarteKey(k), `${p.key} sells ${k}`).toBe(true);
      expect(JSON.stringify(o)).not.toMatch(/\$\s?\d/);
    }
    // Every à la carte item is sold on its page; the texting number is an add-on only (no Buy).
    for (const k of ALACARTE_KEYS) {
      const page = FEATURE_PAGES.find((p) => p.slug === ALACARTE[k].slug);
      expect(page?.offer?.alacarte, k).toContain(k);
    }
    expect(offerOf("texting").alacarte).toEqual([]);
    expect(offerOf("seo").alacarte).toEqual(["seo_basic", "seo_pro"]);
    // The siblings share their item's section.
    expect(offerOf("profileGuard")).toBe(offerOf("gbp"));
    expect(offerOf("ipTracker")).toBe(offerOf("clickGuard"));
    expect(offerOf("vpnShield")).toBe(offerOf("clickGuard"));
    for (const k of ["searchConsole", "domains", "mailAlerts"]) expect(offerOf(k)).toBe(offerOf("cloudflare"));
  });

  it("says one of a kind only where it is", () => {
    expect(offerOf("cloudflare").oneOfAKind).toBe("No other tool does all of this in one place.");
    expect(offerOf("masterClass").oneOfAKind).toBe("As a 50-state licensing and marketing course, we found nothing else like it.");
    for (const p of withOffer) if (!["cloudflare", "searchConsole", "domains", "mailAlerts", "masterClass"].includes(p.key)) expect(p.offer!.oneOfAKind, p.key).toBeUndefined();
  });

  it("the offer line prices from the price book, and the route gate shows the landing page to an account without the tool", () => {
    expect(read("client/src/components/feature-landing/alacarte-offer.tsx")).not.toMatch(/\$\s?\d/);
    expect(offerLine("gbp", "standalone", false)).toBe("$39/mo per location on its own, or $24/mo per location as an add-on to any plan.");
    expect(offerLine("reviews", "addon", true)).toBe("$39/mo as an add-on to your plan ($59/mo on its own).");
    expect(offerLine("seo_basic", "standalone", true)).toBe("$59/mo on its own, or $29/mo as an add-on to any plan.");
    expect(offerLine("jobcam", "standalone", false)).toBe("$59/mo on its own, or $39/mo as an add-on to any plan.");
    const app = read("client/src/App.tsx");
    expect(app.match(/<ToolRouteGate location=\{location\}><DashboardRouter \/><\/ToolRouteGate>/g)?.length).toBe(2);
    const gate = read("client/src/components/tool-route-gate.tsx");
    expect(gate).toContain("if (!user || inNativeApp()) return <>{children}</>;");
    expect(gate).toContain("<FeatureLanding key={page.slug} page={page} />");
  });
});
