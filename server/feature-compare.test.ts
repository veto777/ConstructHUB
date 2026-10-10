import { describe, expect, it } from "vitest";
// The Compare sections of the feature pages (shared/feature-pages/<key>.ts `compare`): every competitor price
// is the one the research file recorded from the vendor's own pricing page (~/codex-audits/a-la-carte-competitors.md,
// 2026-10-10), never typed as "$" in a content file; "what we do that they don't" repeats the page's own claims;
// every item sold on a page exists in the price book; the template renders the band with the Buy / Included offer.
import fs from "fs";
import path from "path";
import { FEATURE_PAGES, featurePageByKey } from "@shared/feature-pages";
import { competitorLine, competitorPriceLabel, comparePricesNote } from "@shared/feature-pages/compare";
import type { FeatureCompare } from "@shared/feature-pages/types";
import { ALACARTE, ALACARTE_KEYS, isAlacarteKey } from "@shared/alacarte";
import { offerLine } from "../client/src/components/feature-landing/alacarte-offer";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const compareOf = (key: string): FeatureCompare => { const c = featurePageByKey(key)!.compare; expect(c, key).toBeDefined(); return c!; };
const priceOf = (key: string, name: string) => { const c = compareOf(key).competitors.find((x) => x.name === name); expect(c, `${key}: ${name}`).toBeDefined(); return c!.price; };

describe("competitor prices come from the research file, in cents", () => {
  it("records the vendor list prices the research found (USD a month unless the kind says otherwise)", () => {
    expect(priceOf("gbp", "Localo")).toEqual({ kind: "monthly", cents: 3900, billed: "annually" });
    expect(priceOf("gbp", "BrightLocal")).toEqual({ kind: "monthly", cents: 5400 });
    expect(priceOf("gbp", "Synup")).toEqual({ kind: "monthly", cents: 4900 });
    expect(priceOf("gbp", "Local Falcon")).toEqual({ kind: "per_unit", cents: 10, unit: "location" });
    expect(priceOf("reviews", "NiceJob")).toEqual({ kind: "monthly", cents: 7500 });
    expect(priceOf("reviews", "GatherUp")).toEqual({ kind: "monthly", cents: 9900 });
    expect(priceOf("reviews", "Grade.us")).toEqual({ kind: "monthly", cents: 9900 });
    expect(priceOf("rankingGrid", "Local Falcon")).toEqual({ kind: "monthly", cents: 2499 });
    expect(priceOf("rankingGrid", "Whitespark")).toEqual({ kind: "monthly_from", cents: 1000 });
    expect(priceOf("rankingGrid", "BrightLocal")).toEqual({ kind: "monthly", cents: 4100 });
    expect(priceOf("rankingGrid", "GMB Briefcase")).toEqual({ kind: "monthly", cents: 9900 });
    expect(priceOf("competitors", "GMB Everywhere")).toEqual({ kind: "monthly", cents: 3000 });
    expect(priceOf("competitors", "NiceJob")).toEqual({ kind: "monthly", cents: 12500 });
    expect(priceOf("siteScan", "Screaming Frog")).toEqual({ kind: "annual", cents: 27900 });
    expect(priceOf("siteScan", "SE Ranking")).toEqual({ kind: "monthly", cents: 12900 });
    expect(priceOf("gbpContent", "OneUp")).toEqual({ kind: "monthly", cents: 1500 });
    expect(priceOf("gbpContent", "Merchynt")).toEqual({ kind: "monthly", cents: 9900 });
    expect(priceOf("adsManager", "LeadUp")).toEqual({ kind: "monthly", cents: 4999 });
    expect(priceOf("adsManager", "Olly Olly")).toEqual({ kind: "quote" });
    expect(compareOf("adsManager").competitors.find((c) => c.name === "Adalysis")?.reported).toBe(true);
    expect(priceOf("clickGuard", "ClickCease")).toEqual({ kind: "monthly", cents: 9900 });
    expect(priceOf("clickGuard", "ClickGUARD")).toEqual({ kind: "monthly", cents: 7400 });
    expect(priceOf("clickGuard", "Fraud Blocker")).toEqual({ kind: "monthly", cents: 7900 });
    expect(priceOf("seo", "Semrush")).toEqual({ kind: "monthly", cents: 13900 });
    expect(priceOf("seo", "Ahrefs")).toEqual({ kind: "monthly", cents: 12900 });
    expect(priceOf("seo", "SE Ranking")).toEqual({ kind: "monthly", cents: 12900 });
    expect(priceOf("cloudflare", "UptimeRobot")).toEqual({ kind: "monthly", cents: 1300 });
    expect(priceOf("cloudflare", "AgencyAnalytics")).toEqual({ kind: "monthly", cents: 2000, billed: "annually" });
    expect(priceOf("social", "Blotato")).toEqual({ kind: "monthly", cents: 2900 });
    expect(priceOf("social", "Marky")).toEqual({ kind: "monthly", cents: 3900 });
    expect(priceOf("social", "SocialPilot")).toEqual({ kind: "monthly", cents: 3000 });
    expect(priceOf("social", "Buffer")).toEqual({ kind: "monthly_from", cents: 500 });
    expect(priceOf("permits", "Shovels.ai")).toEqual({ kind: "monthly", cents: 59900 });
    expect(priceOf("permits", "Construction Monitor")).toEqual({ kind: "monthly_range", fromCents: 3100, toCents: 75000 });
    expect(priceOf("permits", "PropStream")).toEqual({ kind: "monthly", cents: 9900 });
    expect(priceOf("jobcam", "CompanyCam")).toEqual({ kind: "monthly", cents: 7900 });
    expect(priceOf("jobcam", "Fieldwire")).toEqual({ kind: "monthly", cents: 3900, billed: "annually" });
    expect(priceOf("jobcam", "Contractor Foreman")).toEqual({ kind: "monthly", cents: 4900, billed: "annually" });
    expect(priceOf("texting", "Quo (OpenPhone)")).toEqual({ kind: "monthly", cents: 1900 });
    expect(priceOf("texting", "Jobber")).toEqual({ kind: "monthly", cents: 19900 });
    expect(priceOf("texting", "Broadly")).toEqual({ kind: "monthly", cents: 69900 });
    expect(priceOf("masterClass", "Contractor University")).toEqual({ kind: "monthly", cents: 36500 });
    expect(priceOf("masterClass", "Contractor Nation")).toEqual({ kind: "monthly", cents: 50000 });
    expect(priceOf("masterClass", "The Contractor Fight")).toEqual({ kind: "one_time", cents: 240000 });
    expect(priceOf("masterClass", "Breakthrough Academy")).toEqual({ kind: "one_time", cents: 570000 });
  });

  it("formats prices from cents, so a content file never types a dollar figure", () => {
    expect(competitorPriceLabel({ kind: "monthly", cents: 3900, billed: "annually" })).toBe("$39/mo billed annually");
    expect(competitorPriceLabel({ kind: "monthly_from", cents: 1000 })).toBe("from $10/mo");
    expect(competitorPriceLabel({ kind: "monthly_range", fromCents: 3100, toCents: 75000 })).toBe("$31–$750/mo");
    expect(competitorPriceLabel({ kind: "annual", cents: 27900 })).toBe("$279/yr");
    expect(competitorPriceLabel({ kind: "one_time", cents: 240000 })).toBe("$2,400 one-time");
    expect(competitorPriceLabel({ kind: "per_unit", cents: 10, unit: "location" })).toBe("$0.10 per location");
    expect(competitorPriceLabel({ kind: "quote" })).toBe("Quote only");
    expect(competitorLine({ name: "Localo", plan: "Single Business", price: { kind: "monthly", cents: 3900, billed: "annually" }, per: "1 business", source: "x" })).toBe("Localo Single Business — $39/mo billed annually 1 business");
    expect(comparePricesNote("2026-10-10")).toContain("as of 2026-10-10");
  });
});

describe("every Compare section", () => {
  const withCompare = FEATURE_PAGES.filter((p) => p.compare);
  it("exists on each page that sells an item (and the shared ones), with 2–4 named competitors and sources", () => {
    const keys = withCompare.map((p) => p.key).sort();
    expect(keys).toEqual(["adsManager", "clickGuard", "cloudflare", "competitors", "domains", "gbp", "gbpContent", "ipTracker", "jobcam", "mailAlerts", "masterClass", "permits", "profileGuard", "rankingGrid", "reviews", "searchConsole", "seo", "siteScan", "social", "texting", "vpnShield"]);
    for (const p of withCompare) {
      const c = p.compare!;
      expect(c.checkedOn, p.key).toBe("2026-10-10");
      expect(c.competitors.length, p.key).toBeGreaterThanOrEqual(2);
      expect(c.competitors.length, p.key).toBeLessThanOrEqual(5);
      for (const comp of c.competitors) {
        // A price has the vendor's page behind it; a quote-only vendor may have none.
        if (comp.price.kind !== "quote") expect(comp.source, `${p.key}: ${comp.name}`).toMatch(/^https:\/\//);
        expect(comp.name.length).toBeGreaterThan(1);
      }
      expect(c.onlyUs.length, p.key).toBeGreaterThanOrEqual(3);
      expect(c.theyNotUs.length, p.key).toBeGreaterThan(10);
      for (const k of c.alacarte) expect(isAlacarteKey(k), `${p.key} sells ${k}`).toBe(true);
      // No customer-facing vendor name we must not use, and no unverified "ad" price.
      expect(JSON.stringify(c)).not.toMatch(/SignalWire|\$300/);
    }
    // Every à la carte item is sold on its Compare page; the texting number compares without a Buy (add-on only).
    for (const k of ALACARTE_KEYS) {
      const page = FEATURE_PAGES.find((p) => p.slug === ALACARTE[k].slug);
      expect(page?.compare?.alacarte, k).toContain(k);
    }
    expect(compareOf("texting").alacarte).toEqual([]);
    expect(compareOf("seo").alacarte).toEqual(["seo_basic", "seo_pro"]);
    // The siblings share their item's comparison.
    expect(compareOf("profileGuard")).toBe(compareOf("gbp"));
    expect(compareOf("ipTracker")).toBe(compareOf("clickGuard"));
    expect(compareOf("vpnShield")).toBe(compareOf("clickGuard"));
    for (const k of ["searchConsole", "domains", "mailAlerts"]) expect(compareOf(k)).toBe(compareOf("cloudflare"));
  });

  it("says one of a kind only where the research found nothing comparable, and names the contractor gap honestly", () => {
    expect(compareOf("cloudflare").oneOfAKind).toBe("No other tool does all of this in one place.");
    expect(compareOf("masterClass").oneOfAKind).toBe("As a 50-state licensing and marketing course, we found nothing else like it.");
    for (const p of withCompare) if (!["cloudflare", "searchConsole", "domains", "mailAlerts", "masterClass"].includes(p.key)) expect(p.compare!.oneOfAKind, p.key).toBeUndefined();
    for (const k of ["gbp", "rankingGrid", "competitors", "siteScan", "gbpContent", "adsManager", "clickGuard"]) expect(compareOf(k).noContractorAlternative, k).toBe(true);
    for (const k of ["jobcam", "permits", "social", "texting"]) expect(compareOf(k).noContractorAlternative, k).toBeUndefined();
    // The honest gaps the research named.
    expect(compareOf("seo").theyNotUs).toMatch(/Daily rank checks \(ours are weekly/);
    expect(compareOf("reviews").theyNotUs).toMatch(/by text \(ours go by email\)/);
    expect(compareOf("social").theyNotUs).toMatch(/Blotato subscription of your own/);
    expect(compareOf("texting").theyNotUs).toMatch(/two-way inbox/);
  });

  it("the template renders the band with the à la carte offer, and the offer line prices from the price book", () => {
    const landing = read("client/src/components/feature-landing/feature-landing.tsx");
    expect(landing).toContain("<CompareSection");
    expect(landing).toContain("<AlacarteOffer keys={page.compare.alacarte} price={price} slug={page.slug} signedIn={!!user} />");
    const sections = read("client/src/components/feature-landing/sections.tsx");
    expect(sections).toContain("export function CompareSection");
    expect(sections).toContain("competitorPriceLabel(c.price)");
    expect(read("client/src/components/feature-landing/alacarte-offer.tsx")).not.toMatch(/\$\s?\d/);
    expect(offerLine("gbp", "standalone", false)).toBe("$39/mo per location on its own, or $24/mo per location as an add-on to any plan.");
    expect(offerLine("reviews", "addon", true)).toBe("$39/mo as an add-on to your plan ($59/mo on its own).");
    expect(offerLine("seo_basic", "standalone", true)).toBe("$59/mo on its own, or $29/mo as an add-on to any plan.");
    expect(offerLine("jobcam", "standalone", false)).toBe("$59/mo on its own, or $39/mo as an add-on to any plan.");
    // A signed-in account that lacks a tool and lands on its route gets the landing page (the route gate).
    const app = read("client/src/App.tsx");
    expect(app.match(/<ToolRouteGate location=\{location\}><DashboardRouter \/><\/ToolRouteGate>/g)?.length).toBe(2);
    const gate = read("client/src/components/tool-route-gate.tsx");
    expect(gate).toContain("if (!user || inNativeApp()) return <>{children}</>;");
    expect(gate).toContain("<FeatureLanding key={page.slug} page={page} />");
  });
});
