import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  PLANS, PLAN_KEYS, ADDONS, AGENCY_LOCATION_BANDS, SALES_THRESHOLD_CENTS, TRIAL_DAYS,
} from "@shared/plans";
import {
  pricingKnowledge, formatUsd, priceOrSalesRep, joinNames, agencyBandsLine, addonLines,
  AGENCY_ONLY_MODULES, COMPETITOR_INTEL_PLANS, CRM_SEATS_LINE, SALES_REP_LABEL, STARTING_MONTHLY_CENTS,
  CALL_ASSISTANT_INTRO, CALL_ASSISTANT_NUMBER_RULES, callAssistantIntroLine, callAssistantIntroShort, callAssistantPricing, callAssistantYearlyNote,
} from "@shared/plan-copy";
import { knowledgeBook, priceBookCents } from "./hub/knowledge";
import { filterOutput } from "./hub/output-filter";

const filterReply = (content: string) => filterOutput({ content, finishReason: "stop" }, { publicOnly: false });
import { hardRulesText } from "./hub/prompt";
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

describe("AI Call Assistant launch price", () => {
  const root = path.resolve(import.meta.dirname, "..");

  it("is one constant, then the price book's regular price — or the annual price", () => {
    expect(callAssistantIntroLine()).toBe(
      `${formatUsd(CALL_ASSISTANT_INTRO.monthlyCents)}/month for your first ${CALL_ASSISTANT_INTRO.months} months, then ${formatUsd(ADDONS.call_assistant.monthlyCents)}/month — or ${formatUsd(ADDONS.call_assistant.annualCents)}/year`,
    );
    expect(callAssistantIntroShort()).toBe(
      `${formatUsd(CALL_ASSISTANT_INTRO.monthlyCents)}/mo for your first ${CALL_ASSISTANT_INTRO.months} months, then ${formatUsd(ADDONS.call_assistant.monthlyCents)}/mo — or ${formatUsd(ADDONS.call_assistant.annualCents)}/yr`,
    );
    // Owner, 2026-10-02: "$99 a month for the first 3 months" … "annually price can be $1999".
    expect(callAssistantIntroShort()).toBe("$99/mo for your first 3 months, then $249/mo — or $1,999/yr");
    const p = callAssistantPricing();
    expect(p.annual).toBe("$1,999");
    // Add-ons follow the plan's billing interval (server/billing/order.ts): yearly is not a choice for the add-on alone.
    expect(callAssistantYearlyNote()).toBe("$1,999/yr when your plan is billed yearly (add-ons follow your plan's billing); the $99/mo intro for your first 3 months is on monthly billing");
    expect(p.extraNumber).toBe(formatUsd(ADDONS.call_number.monthlyCents));
    expect(p.comingSoon).toBe(ADDONS.call_assistant.preview === true);
    expect(addonLines().find((l) => l.startsWith(ADDONS.call_assistant.name))).toContain(`Launch price: ${callAssistantIntroLine()} (the intro is for monthly billing).`);
    expect(knowledgeBook().pack).toContain(callAssistantIntroLine());
    expect(knowledgeBook().pack).toContain("The intro price is for monthly billing");
  });

  it("$1,999/yr is an add-on annual price, so it shows despite the $1,000 sales threshold", () => {
    expect(ADDONS.call_assistant.annualCents).toBeGreaterThanOrEqual(SALES_THRESHOLD_CENTS);
    // The price-book helpers print it (the threshold applies to services, not plan/add-on annual prices) …
    expect(addonLines().find((l) => l.startsWith(ADDONS.call_assistant.name))).toContain(`or ${formatUsd(ADDONS.call_assistant.annualCents)}/year`);
    // … the knowledge pack says yearly is NOT 10 × monthly for this add-on …
    expect(pricingKnowledge()).toContain(`except the ${ADDONS.call_assistant.name}, which is ${formatUsd(ADDONS.call_assistant.annualCents)}/year`);
    // … and the Hub's output filter lets Gabe say it.
    expect(priceBookCents().has(ADDONS.call_assistant.annualCents)).toBe(true);
    expect(filterReply(`The AI Call Assistant is ${callAssistantIntroLine()}.`).ok).toBe(true);
    expect(filterReply(`On yearly billing the AI Call Assistant add-on costs ${formatUsd(ADDONS.call_assistant.annualCents)}/year on the Pro plan.`).ok).toBe(true);
    // A made-up yearly price is still refused.
    expect(filterReply("The AI Call Assistant add-on costs $1,899/year.").ok).toBe(false);
  });

  it("the number rules (owner, 2026-10-02) are stated on the FAQ, the Numbers tab and in Gabe's knowledge", () => {
    const faq = fs.readFileSync(path.join(root, "client/src/pages/call-assistant-landing.tsx"), "utf8");
    const numbers = fs.readFileSync(path.join(root, "client/src/pages/crm-call-assistant/numbers.tsx"), "utf8");
    for (const key of ["ownNumbers", "cancel", "payment"] as const) {
      expect(faq).toContain(`CALL_ASSISTANT_NUMBER_RULES.${key}`);
      expect(numbers).toContain(`CALL_ASSISTANT_NUMBER_RULES.${key}`);
      expect(knowledgeBook().pack).toContain(CALL_ASSISTANT_NUMBER_RULES[key]);
    }
    expect(CALL_ASSISTANT_NUMBER_RULES.ownNumbers).toMatch(/never moved/);
    expect(CALL_ASSISTANT_NUMBER_RULES.cancel).toMatch(/part of the service.*cancel.*released and stops working/);
    expect(CALL_ASSISTANT_NUMBER_RULES.payment).toMatch(/payment fails.*pauses until the card is updated/);
  });

  it.each([
    "client/src/pages/landing.tsx", "client/src/pages/call-assistant-landing.tsx",
    "client/src/components/call-assistant-marketing.tsx", "client/src/pages/pricing.tsx",
    "client/src/pages/crm-call-assistant/overview.tsx", "client/src/pages/crm-call-assistant/index.tsx",
    "client/src/pages/crm-call-assistant/numbers.tsx",
  ])("%s types no Call Assistant price (it renders them from the price book)", (file) => {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    for (const cents of [CALL_ASSISTANT_INTRO.monthlyCents, ADDONS.call_assistant.monthlyCents, ADDONS.call_assistant.annualCents, ADDONS.call_number.monthlyCents]) {
      expect(src).not.toMatch(new RegExp(`\\${formatUsd(cents).replace(".", "\\.")}(?![\\d,])`));
    }
  });
});

describe("AI assistant prompts use the price book", () => {
  const knowledge = pricingKnowledge();
  // The Hub (corner assistant, server/hub) replaced the old site assistant.
  const HUB_TEXT = `${hardRulesText()}\n${knowledgeBook().pack}`;

  it("lists every plan at its monthly and annual price, the trial and no free plan", () => {
    for (const key of PLAN_KEYS) {
      expect(knowledge).toContain(`**${PLANS[key].name}** — ${formatUsd(PLANS[key].monthlyCents)}/month or ${formatUsd(PLANS[key].annualCents)}/year`);
    }
    expect(knowledge).toContain(`${TRIAL_DAYS}-day trial`);
    expect(knowledge).toContain("There is no free plan");
    expect(knowledge).toContain(`Only the Agency plan includes: ${joinNames(AGENCY_ONLY_MODULES)}`);
  });

  for (const [name, text] of [
    ["hub assistant", HUB_TEXT],
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

  it("hub assistant quotes no service at or above the sales threshold", () => {
    // The only amounts of $1,000 or more it may state are annual plan and
    // add-on prices (10 × a listed monthly price) and the threshold itself
    // ("priced at $1,000 or more").
    const planAnnual = new Set([
      ...PLAN_KEYS.map((k) => PLANS[k].annualCents),
      ...Object.values(ADDONS).map((a) => a.annualCents),
      SALES_THRESHOLD_CENTS,
    ]);
    const text = HUB_TEXT;
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
    "home", "landing", "master-class", "reinstatement", "terms-of-use", "privacy-policy", "crm-gateway", "crm-legal",
    "competitors", "google-ads-guide", "call-assistant-landing",
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

  it.each(["landing", "terms-of-use", "call-assistant-landing"])(
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
