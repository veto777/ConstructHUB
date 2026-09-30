import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  PLANS, PLAN_KEYS, ADDONS, AGENCY_LOCATION_BANDS, SALES_THRESHOLD_CENTS, TRIAL_DAYS,
} from "@shared/plans";
import {
  pricingKnowledge, formatUsd, priceOrSalesRep, joinNames, agencyBandsLine, addonLines,
  AGENCY_ONLY_MODULES, COMPETITOR_INTEL_PLANS, CRM_SEATS_LINE, SALES_REP_LABEL, STARTING_MONTHLY_CENTS,
} from "@shared/plan-copy";
import { SITE_ASSISTANT_KNOWLEDGE, SITE_ASSISTANT_PROMPT } from "./site-assistant";
import { ADS_CONSULTANT_KNOWLEDGE, ADS_CONSULTANT_PROMPT } from "./ads-consultant";
import { TRIAL_CODE_PLAN_NAME } from "./email";
import { INFO_CONTENT } from "../client/src/lib/info-content";

/**
 * Pricing p5 (copy): every page, prompt and email outside /pricing describes
 * the 2026-09-30 price book (shared/plans.ts) — no legacy plans, no invented
 * products, and nothing at or above the sales threshold shows a price.
 */

const LEGACY_PLAN = /\b(Standard|Professional|Business|Premium|Gold|Platinum)\s+(plan|plans|member|members|subscriber|subscribers|tier)\b/i;
const LEGACY_WORDS = [/\bPlatinum\b/, /\$995\b/, /\$499\/mo/, /Unlimited everything/i, /\$9,999/, /billed separately/i, /separate membership/i];

/** Every "$1,234"-style amount in a text, in cents. */
function dollarAmounts(text: string): number[] {
  return [...text.matchAll(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g)].map((m) => Math.round(Number(m[1].replace(/,/g, "")) * 100));
}

describe("plan copy helpers", () => {
  it("formats cents as whole dollars unless there are cents", () => {
    expect(formatUsd(2900)).toBe("$29");
    expect(formatUsd(199000)).toBe("$1,990");
    expect(formatUsd(2)).toBe("$0.02");
  });

  it("shows a price only under the sales threshold", () => {
    expect(priceOrSalesRep(SALES_THRESHOLD_CENTS - 1)).toBe(formatUsd(SALES_THRESHOLD_CENTS - 1));
    expect(priceOrSalesRep(SALES_THRESHOLD_CENTS)).toBe(SALES_REP_LABEL);
    expect(priceOrSalesRep(249900)).toBe("Talk to a sales rep");
    expect(priceOrSalesRep(59900)).toBe("$599");
    expect(priceOrSalesRep(49900)).toBe("$499");
  });

  it("joins names in reading order", () => {
    expect(joinNames(["Pro"])).toBe("Pro");
    expect(joinNames(["Pro", "Growth"])).toBe("Pro and Growth");
    expect(joinNames(["Pro", "Growth", "Agency"])).toBe("Pro, Growth and Agency");
  });

  it("derives plan facts from the price book", () => {
    expect(STARTING_MONTHLY_CENTS).toBe(PLANS.starter.monthlyCents);
    expect(AGENCY_ONLY_MODULES).toEqual(["Agency workspace", "Google Ads & LSA manager", "Cloudflare + Search Console", "Domains + Gmail alerts"]);
    expect(COMPETITOR_INTEL_PLANS).toBe("Pro, Growth and Agency");
    expect(CRM_SEATS_LINE).toBe(PLAN_KEYS.map((k) => `${PLANS[k].name} ${PLANS[k].limits.crmSeats}`).join(", ").replace(/, ([^,]*)$/, " and $1"));
  });

  it("describes every paid Agency location band", () => {
    const line = agencyBandsLine();
    for (const band of AGENCY_LOCATION_BANDS.filter((b) => b.centsPerLocation > 0)) {
      expect(line).toContain(`${formatUsd(band.centsPerLocation)}/month each`);
      expect(line).toContain(`–${band.upTo}`);
    }
    expect(line).toMatch(/above 500 locations .*sales rep/);
  });

  it("lists every add-on with its price and plans", () => {
    const lines = addonLines();
    expect(lines).toHaveLength(Object.keys(ADDONS).length);
    for (const addon of Object.values(ADDONS)) {
      expect(lines.some((l) => l.startsWith(`${addon.name} — ${formatUsd(addon.monthlyCents)}/month`))).toBe(true);
    }
  });
});

describe("AI assistant prompts use the price book", () => {
  const knowledge = pricingKnowledge();

  it("lists every plan at its monthly and annual price, the trial and no free plan", () => {
    for (const key of PLAN_KEYS) {
      expect(knowledge).toContain(`**${PLANS[key].name}** — ${formatUsd(PLANS[key].monthlyCents)}/month or ${formatUsd(PLANS[key].annualCents)}/year`);
    }
    expect(knowledge).toContain(`${TRIAL_DAYS}-day trial`);
    expect(knowledge).toContain("There is no free plan");
    expect(knowledge).toContain(`Only the Agency plan includes: ${joinNames(AGENCY_ONLY_MODULES)}`);
  });

  for (const [name, text] of [
    ["site assistant", `${SITE_ASSISTANT_PROMPT}\n${SITE_ASSISTANT_KNOWLEDGE}`],
    ["ads consultant", `${ADS_CONSULTANT_PROMPT}\n${ADS_CONSULTANT_KNOWLEDGE}`],
  ] as const) {
    it(`${name}: no legacy plans, invented products or guarantees`, () => {
      expect(text).toContain(knowledge);
      expect(text).not.toMatch(LEGACY_PLAN);
      for (const word of LEGACY_WORDS) expect(text).not.toMatch(word);
      expect(text).not.toMatch(/free trial/i);
      expect(text).not.toMatch(/guaranteed top/i);
      expect(text).not.toMatch(/consulting team/i);
      expect(text).toContain(SALES_REP_LABEL);
    });
  }

  it("site assistant quotes no service at or above the sales threshold", () => {
    // The only amounts of $1,000 or more it may state are annual plan prices
    // and the threshold itself ("priced at $1,000 or more").
    const planAnnual = new Set([...PLAN_KEYS.map((k) => PLANS[k].annualCents), SALES_THRESHOLD_CENTS]);
    const text = `${SITE_ASSISTANT_PROMPT}\n${SITE_ASSISTANT_KNOWLEDGE}`;
    const overThreshold = dollarAmounts(text).filter((c) => c >= SALES_THRESHOLD_CENTS && !planAnnual.has(c));
    expect(overThreshold.map(formatUsd)).toEqual([]);
    expect(text).not.toMatch(/32,864/);
    expect(text).toContain("$599 per project");
  });

  it("ads consultant keeps the Ads & LSA manager on Agency and points to sales", () => {
    expect(ADS_CONSULTANT_KNOWLEDGE).toContain("The Google Ads & LSA manager is part of the Agency plan only.");
    expect(ADS_CONSULTANT_PROMPT).toMatch(/Never invent a product, package, discount or price/);
  });
});

describe("emails and in-app help", () => {
  it("trial-code invites name the plan whose entitlements the code grants", () => {
    expect(TRIAL_CODE_PLAN_NAME).toBe("Agency");
  });

  it("the SMS info tip names the texting plans from the price book", () => {
    const body = INFO_CONTENT["settings-sms"].body.join(" ");
    expect(body).toContain("Pro, Growth and Agency");
    expect(body).toContain("Growth includes one number");
  });
});

describe("page copy outside /pricing", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const PAGES = [
    "home", "landing", "permits-landing", "competitors-landing", "google-ads-landing", "master-class",
    "master-class-landing", "reinstatement", "terms-of-use", "privacy-policy", "crm-gateway", "crm-legal",
    "competitors", "google-ads-guide",
  ].map((p) => `client/src/pages/${p}.tsx`);
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

  it.each(PAGES)("%s names no legacy plan or price", (file) => {
    const src = read(file);
    expect(src).not.toMatch(LEGACY_PLAN);
    for (const word of LEGACY_WORDS) expect(src).not.toMatch(word);
    // Legacy plan prices ($100/month also appears in course text about insurance).
    expect(src).not.toMatch(/\$15\/month|\$30\/month|\$50\/month|\$15 a month/);
    expect(src).not.toMatch(/["'](gold|platinum)["']/);
  });

  it.each(["landing", "master-class-landing", "terms-of-use"])(
    "%s prints no literal price at or above the sales threshold",
    (page) => {
      const src = read(`client/src/pages/${page}.tsx`);
      expect(dollarAmounts(src).filter((c) => c >= SALES_THRESHOLD_CENTS).map(formatUsd)).toEqual([]);
    },
  );

  it("master-class prices its modules from the modules table, not literals", () => {
    // The course text itself quotes job values and ad budgets; only the
    // selling surfaces are checked here.
    const src = read("client/src/pages/master-class.tsx");
    expect(src).not.toMatch(/(price|value): "\$\d/);
    expect(src).toContain("const bundlePriceShown = showsPrice(BUNDLE_PRICE_CENTS)");
    expect(src).toContain("showsPrice(mod.price)");
  });

  it("master-class shows the bundle price only behind the sales-threshold check", () => {
    // Every place that prints the bundle price must sit in a bundlePriceShown
    // branch — the overview tab's stat card once printed it unconditionally.
    const lines = read("client/src/pages/master-class.tsx").split("\n");
    const sites = lines.map((line, i) => ({ line, i })).filter(({ line }) => line.includes("usd(BUNDLE_PRICE_CENTS)"));
    expect(sites.length).toBeGreaterThan(0);
    for (const { i } of sites) {
      const context = lines.slice(Math.max(0, i - 45), i + 1).join("\n");
      expect(context, `line ${i + 1}`).toMatch(/bundlePriceShown/);
    }
  });

  it("home no longer links to the retired individual-tools page", () => {
    expect(read("client/src/pages/home.tsx")).not.toContain("/individual-pricing");
  });

  it("the Terms are dated September 30, 2026 and list plans from the price book", () => {
    const src = read("client/src/pages/terms-of-use.tsx");
    expect(src).toContain('const LAST_UPDATED = "September 30, 2026"');
    expect(src).toContain("PLAN_KEYS.map");
    expect(src).toContain("Object.values(ADDONS)");
    expect(src).not.toMatch(/Individual Tool Pricing/);
  });

  it("the Competitor Intel page asks the server, not the client, for the plan", () => {
    const src = read("client/src/pages/competitors.tsx");
    expect(src).not.toContain("/api/stripe/subscription");
    expect(src).toContain('code !== "plan_required"');
  });
});
