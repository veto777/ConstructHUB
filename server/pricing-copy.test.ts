import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  PLANS, PLAN_KEYS, ADDONS, SALES_THRESHOLD_CENTS, TRIAL_DAYS,
} from "@shared/plans";
import { CRM_PLANS, CRM_PLAN_KEYS } from "@shared/crm-plans";
import * as planCopy from "@shared/plan-copy";
import {
  planNamesWhere, pricingKnowledge, formatUsd, priceOrSalesRep, joinNames, addonLines, annualExceptionsLine, PLATFORM_ADDONS,
  AGENCY_ONLY_MODULES, COMPETITOR_INTEL_PLANS, CRM_SEATS_LINE, CRM_TEXTING_PLANS, CLIENT_NUMBER_INCLUDED_PLANS, SALES_REP_LABEL, STARTING_MONTHLY_CENTS,
  CALL_ASSISTANT_NUMBER_RULES, CALL_ASSISTANT_SPAM, CALL_ASSISTANT_SEPARATE_LINE, CALL_ASSISTANT_FROM_PRICE, TEXTING_PLANS, callAssistantPricing, callAssistantYearlyNote, callAssistantAboveTopLine,
  callAssistantTiers, callAssistantTiersLine, callAssistantTierAdvice, callAssistantSpamAllowanceLine, callAssistantIncludesLine, callAssistantMinuteRule, callAssistantTierNumbersLine, CALL_ASSISTANT_SPAM_BLOCK_TITLE,
  callAssistantOverageLine, callAssistantOverageRule, callAssistantOverageStatusLine, callAssistantTiersShortLine, callAssistantAvailabilityLine, formatCentsShort,
} from "@shared/plan-copy";
import { CALL_ASSISTANT_TIERS, CALL_ASSISTANT_FREE_SPAM_CALLS, CALL_ASSISTANT_OVERAGE_RATES, CALL_ASSISTANT_ANNUAL_MONTHS } from "@shared/plans";
import { ALACARTE_KEYS, alacartePriceCents } from "@shared/alacarte";
import { SPAM_STRIKES_TO_BLOCK } from "./voice/spam";
import { COURSE_BUNDLE } from "./catalog";
import { FORWARDING_ADVICE } from "./voice/numbers";
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
// $499/mo was a retired price until 2026-10-09; it is now CRM Elite's, so it is no longer a legacy word.
const LEGACY_WORDS = [/\bPlatinum\b/, /\$995\b/, /Unlimited everything/i, /\$9,999/, /billed separately/i, /separate membership/i];

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
    // Modules whose cheapest plan is the Unlimited key (whiteLabel, masterClass) — the cost-based ladder.
    expect(AGENCY_ONLY_MODULES).toEqual(["White-label reports", "Master Class"]);
    expect(COMPETITOR_INTEL_PLANS).toBe("Solo, Team, Pro, Agency and Unlimited");
    expect(CRM_SEATS_LINE).toBe(CRM_PLAN_KEYS.map((k) => `${CRM_PLANS[k].name} ${CRM_PLANS[k].limits.seats}`).join(", ").replace(/, ([^,]*)$/, " and $1"));
  });

  it("lists every PLATFORM add-on with its price and plans (the AI Call Assistant's lines are its own subscription's, listed with the service)", () => {
    const lines = addonLines();
    expect(lines).toHaveLength(PLATFORM_ADDONS.length);
    // 5 Call Assistant lines (4 tiers + the extra number) and the retired extra-location add-on are not platform add-ons.
    expect(PLATFORM_ADDONS.length).toBe(Object.keys(ADDONS).length - 6);
    for (const addon of PLATFORM_ADDONS) {
      expect(lines.some((l) => l.startsWith(`${addon.name} — ${formatUsd(addon.monthlyCents)}/month`))).toBe(true);
    }
    expect(lines.join(" ")).not.toMatch(/Call Assistant/);
    // The retired extra-location add-on is never described to customers or the AI.
    expect(lines.join(" ")).not.toMatch(/Extra location/i);
    expect(PLATFORM_ADDONS.map((a) => a.key)).not.toContain("extra_location");
    // Every sold platform add-on is ANNUAL_MONTHS × monthly yearly, so there is no exception to state.
    expect(annualExceptionsLine()).toBe("");
  });
});

describe("AI Call Assistant: a separate service (owner, 2026-10-08)", () => {
  const root = path.resolve(import.meta.dirname, "..");

  it("four tiers, every figure from the price book: 500 / 1,000 / 2,000 / 5,000 minutes, one overage rate, yearly 11 × monthly, no intro", () => {
    const tiers = callAssistantTiers();
    expect(tiers.map((t) => [t.name, t.monthly, t.annual, t.minutes, t.numbersLabel, t.overage, t.overageShort])).toEqual([
      ["500 minutes", "$249", "$2,739", "500", "1 local number", "$0.50", "50¢"],
      ["1,000 minutes", "$349", "$3,839", "1,000", "1 local number", "$0.50", "50¢"],
      ["2,000 minutes", "$449", "$4,939", "2,000", "2 local numbers", "$0.50", "50¢"],
      ["5,000 minutes", "$999", "$10,989", "5,000", "5 local numbers", "$0.50", "50¢"],
    ]);
    // ~2 min a call.
    expect(tiers.map((t) => t.estimatedCalls)).toEqual(["about 250 calls a month", "about 500 calls a month", "about 1,000 calls a month", "about 2,500 calls a month"]);
    expect(callAssistantTiersLine()).toBe("500 minutes a month with 1 local number for $249/month or $2,739/year, 1,000 minutes a month with 1 local number for $349/month or $3,839/year, 2,000 minutes a month with 2 local numbers for $449/month or $4,939/year and 5,000 minutes a month with 5 local numbers for $999/month or $10,989/year; above the included minutes, $0.50 a minute on every tier");
    expect(callAssistantTiersShortLine()).toBe("500 minutes $249/month, 1,000 minutes $349/month, 2,000 minutes $449/month and 5,000 minutes $999/month");
    expect(callAssistantYearlyNote()).toBe("Yearly billing is 11 times the monthly price, so one month is free: 500 minutes $2,739/yr, 1,000 minutes $3,839/yr, 2,000 minutes $4,939/yr and 5,000 minutes $10,989/yr. The AI Call Assistant is billed on its own subscription, apart from any plan");
    expect(callAssistantTierAdvice()).toBe("At about 2 minutes a call, 500 minutes covers about 250 calls a month, 1,000 minutes covers about 500 calls a month, 2,000 minutes covers about 1,000 calls a month and 5,000 minutes covers about 2,500 calls a month. These are estimates: your calls may run shorter or longer, and you can move between tiers any time in Settings → Billing. More than 5,000 minutes a month is quoted by a sales rep (Talk to a sales rep): there is no listed price above the 5,000 minutes tier.");
    expect(callAssistantAboveTopLine()).toBe("More than 5,000 minutes a month is quoted by a sales rep (Talk to a sales rep): there is no listed price above the 5,000 minutes tier.");
    const p = callAssistantPricing();
    expect([p.from, p.fromTier, p.fromPrice, p.top, p.topTier, p.topMinutes, p.tierCountWord, p.overage, p.overageLine, p.extraNumber, p.extraNumberAnnual, p.freeSpamCalls, p.annualMonths, p.annualFreeMonths])
      .toEqual(["$249", "500 minutes", "$249/mo", "$999", "5,000 minutes", "5,000", "four", "$0.50", "$0.50 a minute on every tier", "$5", "$50", "500", 11, 1]);
    expect(p.comingSoon).toBe(ADDONS.call_assistant.preview === true);
    expect(p.separateLine).toBe(CALL_ASSISTANT_SEPARATE_LINE);
    expect(p.pricingHref).toBe("/pricing#call-assistant");
    expect(CALL_ASSISTANT_SEPARATE_LINE).toBe("The AI Call Assistant is a separate service with its own subscription, from $249/mo: no ConstructHUB plan includes it, and none is needed to buy it.");
    expect(CALL_ASSISTANT_FROM_PRICE).toBe("$249/mo");
    expect(CALL_ASSISTANT_ANNUAL_MONTHS).toBe(11);
    expect(callAssistantOverageLine()).toBe(p.overageLine);
    expect(CALL_ASSISTANT_OVERAGE_RATES.map(formatCentsShort)).toEqual(["50¢"]);
    expect(callAssistantSpamAllowanceLine()).toBe("the first 500 spam calls each month never count toward your minutes, on every tier");
    expect(callAssistantTierNumbersLine()).toBe("the 500 minutes tier includes 1 local number, the 1,000 minutes tier 1, the 2,000 minutes tier 2 and the 5,000 minutes tier 5");
    expect(callAssistantIncludesLine()).toBe("minutes above a tier's included ones are $0.50 a minute on every tier; extra numbers are $5/month each; and the first 500 spam calls each month never count toward your minutes, on every tier");
    // Static copy (the FAQ, Gabe's pack) names the rate and never promises when it is charged: that depends on the
    // server's overage switch, which only callAssistantOverageStatusLine (the signed-in surfaces) reads.
    expect(callAssistantOverageRule()).toBe("Each tier includes its minutes every calendar month. Above them, it's $0.50 a minute on every tier. Each call is counted at the rate in force when it ends, so a mid-month change of tier never reprices calls already taken.");
    expect(callAssistantOverageRule()).not.toMatch(/invoice|billed/);
    expect(callAssistantOverageStatusLine("off")).toBe("Minutes above your plan are counted but not charged yet; the rate is 50¢ a minute.");
    expect(callAssistantOverageStatusLine(undefined)).toBe(callAssistantOverageStatusLine("off"));
    expect(callAssistantOverageStatusLine("on")).toBe("Minutes above your plan are 50¢ a minute, on your next invoice.");
    expect(callAssistantOverageStatusLine("off", 10)).toContain("10¢ a minute");
    expect(callAssistantMinuteRule()).toMatch(/every started minute/i);
    expect(callAssistantAvailabilityLine()).toBe("Buy it on Pricing (/pricing#call-assistant) as its own subscription, with or without a ConstructHUB plan; change tiers any time in Settings → Billing.");
    // No intro price: the helpers that carried it are gone, and no tier has one.
    for (const gone of ["callAssistantIntroLine", "callAssistantIntroShort", "CALL_ASSISTANT_INTRO", "CALL_ASSISTANT_PLANS"]) expect((planCopy as any)[gone], gone).toBeUndefined();
    for (const t of CALL_ASSISTANT_TIERS) expect(ADDONS[t.addon].introMonthlyCents, t.tier).toBeUndefined();
    for (const line of [callAssistantTiersLine(), callAssistantYearlyNote(), callAssistantTierAdvice(), CALL_ASSISTANT_SEPARATE_LINE, pricingKnowledge()]) {
      expect(line).not.toMatch(/launch price is|first 3 months|an add-on to the (Pro|Growth|Agency)/i);
    }
  });

  it("the Hub's knowledge pack states every figure, the price book allows them, and the old prices are gone", () => {
    const pack = knowledgeBook().pack;
    for (const line of [callAssistantTiersLine(), callAssistantTierAdvice(), callAssistantYearlyNote(), callAssistantAboveTopLine(), callAssistantTierNumbersLine(),
      callAssistantOverageRule(), CALL_ASSISTANT_SEPARATE_LINE, CALL_ASSISTANT_SPAM.block, CALL_ASSISTANT_SPAM.forwarding]) expect(pack).toContain(line);
    expect(pack).toContain("four tiers, one per account");
    expect(pack).toContain("There is no intro or launch price");
    expect(pack).toContain("## 30. AI Call Assistant (a separate service)");
    expect(pack).not.toMatch(/launch price is|for your first 3 months|an add-on to the|\(an add-on,|Call Assistant add-on\b/);
    expect(pack).not.toContain("{{");
    expect(pricingKnowledge()).toContain("a SEPARATE SERVICE with its own subscription, not a plan add-on");
    // Every tier's monthly and yearly price, the overage and the extra number are listed amounts.
    for (const t of CALL_ASSISTANT_TIERS) expect(priceBookCents().has(t.monthlyCents) && priceBookCents().has(t.annualCents), t.tier).toBe(true);
    expect(priceBookCents().has(50)).toBe(true);
    expect(priceBookCents().has(ADDONS.call_number.annualCents)).toBe(true);
    // The old prices are not: $799, the $99 intro, $1,199 / $1,999 / $3,599 / $6,399 a year, 10¢ and 5¢ a minute.
    // ($149 stays listed by coincidence: CRM Max's yearly price works out to $149 a month.)
    for (const c of [79_900, 119_900, 199_900, 359_900, 639_900, 10, 5]) expect(priceBookCents().has(c), String(c)).toBe(false);
    // $249 and $449 stay listed: they are the new 500 and 2,000 minutes tiers.
    expect(priceBookCents().has(24_900) && priceBookCents().has(44_900)).toBe(true);
    // Gabe may name a tier and quote its price, its overage and its yearly price; an old or made-up price is refused.
    expect(filterReply("The 2,000 minutes tier is $449/month with 2 local numbers; 5,000 minutes is $999/month.").ok).toBe(true);
    expect(filterReply("The 500 minutes tier is $249/month, then $0.50 a minute over, or $2,739/year on yearly billing.").ok).toBe(true);
    expect(filterReply(`${CALL_ASSISTANT_SEPARATE_LINE}`).ok).toBe(true);
    expect(filterReply("The Lite tier is $149/month with 2,000 minutes.").ok).toBe(false);
    expect(filterReply("The Fleet tier costs $799/month or $6,399/year.").ok).toBe(false);
    expect(filterReply("Solo is $99/month for your first 3 months.").ok).toBe(false);
    expect(filterReply("Extra minutes are 10 cents each.").ok).toBe(false);
    expect(filterReply("The AI Call Assistant is an add-on to the Pro plan.").ok).toBe(false);
    expect(filterReply("The Agency plan includes the AI Call Assistant.").ok).toBe(false);
  });

  it("yearly prices above the $1,000 threshold still show: they are listed prices, not a sales quote", () => {
    expect(ADDONS.call_assistant_fleet.annualCents).toBeGreaterThanOrEqual(SALES_THRESHOLD_CENTS);
    expect(pricingKnowledge()).toContain(`${formatUsd(ADDONS.call_assistant_fleet.annualCents)}/year`);
    expect(priceBookCents().has(ADDONS.call_assistant_fleet.annualCents)).toBe(true);
    expect(filterReply(`On yearly billing the 5,000 minutes tier is ${formatUsd(ADDONS.call_assistant_fleet.annualCents)}/year.`).ok).toBe(true);
    // A made-up yearly price is still refused.
    expect(filterReply("The AI Call Assistant costs $1,899/year.").ok).toBe(false);
  });

  it("the spam promise only says what the code does", () => {
    // "Caught twice as near-certain spam" is server/voice/spam.ts's rule: two strikes, each at strike confidence (not merely flagged).
    expect(SPAM_STRIKES_TO_BLOCK).toBe(2);
    expect(CALL_ASSISTANT_SPAM.block).toMatch(/caught twice as near-certain spam is blocked/);
    expect(CALL_ASSISTANT_SPAM_BLOCK_TITLE).toBe("Two strikes, blocked before it's answered");
    // The "never answer spam" promise is tied to forwarding: no-answer forwarding still rings the contractor first.
    expect(CALL_ASSISTANT_SPAM.lead).toMatch(/^Forward your line to your assistant/);
    expect(CALL_ASSISTANT_SPAM.screen).toMatch(/on calls forwarded to your assistant/);
    expect(CALL_ASSISTANT_SPAM.forwarding).toMatch(/no-answer.*rings you first.*'always'/);
    expect(FORWARDING_ADVICE[0]).toContain(CALL_ASSISTANT_SPAM.forwarding);
    // "Blocked" means rejected before answering; the month's screened + rejected total is "stopped".
    for (const f of ["client/src/pages/crm-call-assistant/calls.tsx", "client/src/pages/crm-call-assistant/overview.tsx"]) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      expect(src).toContain("Spam stopped this month");
      expect(src).not.toContain("Spam blocked this month");
    }
    expect(CALL_ASSISTANT_SPAM.headline).toBe("You never answer a spam call again");
    expect(CALL_ASSISTANT_SPAM.report).toMatch(/weekly email/);
    expect(CALL_ASSISTANT_FREE_SPAM_CALLS).toBe(500);
    // Never a claim the product doesn't make (reporting to carriers or regulators, "guaranteed").
    for (const line of Object.values(CALL_ASSISTANT_SPAM)) expect(line).not.toMatch(/FTC|FCC|carrier report|guarantee|100%/i);
    const page = fs.readFileSync(path.join(root, "client/src/pages/call-assistant-landing.tsx"), "utf8");
    for (const key of ["headline", "lead", "screen", "block", "forwarding", "report"] as const) expect(page).toContain(`CALL_ASSISTANT_SPAM.${key}`);
    expect(page).toContain("CALL_ASSISTANT_SPAM_BLOCK_TITLE");
    for (const q of ["What counts as a minute?", "Do spam calls use my minutes?", "Which tier do I need?", "Do I need a ConstructHUB plan?", "What if I need more than the top tier?"]) expect(page).toContain(q);
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
    "client/src/pages/crm-call-assistant/numbers.tsx", "client/src/pages/crm-call-assistant/calls.tsx",
    "client/src/components/call-assistant-tiers.tsx", "client/src/components/call-assistant-billing-card.tsx",
    "client/src/pages/settings/plan-billing.tsx", "client/src/pages/settings/limits-usage.tsx", "client/src/pages/settings/billing/subscriptions-panel.tsx",
    "client/src/pages/terms-of-use.tsx",
  ])("%s types no Call Assistant price, minutes or spam allowance (it renders them from the price book)", (file) => {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    const cents = [
      ADDONS.call_number.monthlyCents, ADDONS.call_number.annualCents, ...CALL_ASSISTANT_OVERAGE_RATES,
      ...CALL_ASSISTANT_TIERS.flatMap((t) => [t.monthlyCents, t.annualCents]),
    ];
    for (const c of cents) expect(src, formatUsd(c)).not.toMatch(new RegExp(`\\${formatUsd(c).replace(".", "\\.")}(?![\\d,])`));
    // Nor a per-minute overage typed in cents ("50¢", "50 cents").
    for (const rate of CALL_ASSISTANT_OVERAGE_RATES) expect(src).not.toMatch(new RegExp(`(?<![\\d.])${rate}(¢| ?cents)`));
    // Tier minutes and the free spam calls, typed as copy ("500 minutes", "500 spam calls").
    for (const t of CALL_ASSISTANT_TIERS) expect(src).not.toMatch(new RegExp(`\\b${t.includedMinutes.toLocaleString("en-US")} (call )?min`));
    expect(src).not.toMatch(new RegExp(`\\b${CALL_ASSISTANT_FREE_SPAM_CALLS} spam`));
    // And never the old model's words: a launch intro, or "an add-on for the … plans".
    expect(src).not.toMatch(/launch price|for your first \d+ months|an add-on for the/i);
  });

  it("the Call Assistant's own section is the one place Pricing sells it; nothing else on the page lists its lines", () => {
    const pricing = fs.readFileSync(path.join(root, "client/src/pages/pricing.tsx"), "utf8");
    expect(pricing).toContain('id="call-assistant"');
    expect(pricing).toContain("CallAssistantPlanCards");
    expect(pricing).toContain("isCallAssistantAddon(k)");
    expect(pricing).not.toContain("CallAssistantTierCards interval");
    expect(pricing).toContain("call_assistant_success");
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
    // No per-location pricing anywhere in the AI's price book (bands retired 2026-10-09).
    expect(knowledge).not.toMatch(/per location|location band/i);
    expect(knowledge).toContain(`Only the ${PLANS.agency.name} plan includes: ${joinNames(AGENCY_ONLY_MODULES)}`);
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
    // add-on prices (ANNUAL_MONTHS × a listed monthly price) and the threshold itself
    // ("priced at $1,000 or more").
    const planAnnual = new Set([
      ...PLAN_KEYS.map((k) => PLANS[k].annualCents),
      ...Object.values(ADDONS).map((a) => a.annualCents),
      // The CRM is its own product: its plans' yearly prices are listed prices too.
      ...CRM_PLAN_KEYS.map((k) => CRM_PLANS[k].annualCents),
      // The Unlimited plan's own feature line states the Master Class's listed price.
      COURSE_BUNDLE.priceCents,
      // Every tool à la carte (shared/alacarte.ts): the yearly prices of both tiers are listed prices too.
      ...ALACARTE_KEYS.flatMap((k) => [alacartePriceCents(k, "standalone", "year"), alacartePriceCents(k, "addon", "year")]),
      SALES_THRESHOLD_CENTS,
    ]);
    const text = HUB_TEXT;
    const overThreshold = dollarAmounts(text).filter((c) => c >= SALES_THRESHOLD_CENTS && !planAnnual.has(c));
    expect(overThreshold.map(formatUsd)).toEqual([]);
    expect(text).not.toMatch(/32,864/);
    expect(text).toContain("$599 per project");
  });

  it("ads consultant derives Ads & LSA manager access from the price book", () => {
    // The module is included on Pro and above.
    expect(ADS_CONSULTANT_KNOWLEDGE).toContain(`The Google Ads & LSA manager is part of the ${planNamesWhere((plan) => plan.modules.adsManager)} plans.`);
    expect(ADS_CONSULTANT_PROMPT).toMatch(/Never invent a product, package, discount or price/);
  });
});

describe("emails and in-app help", () => {
  it("trial-code invites name the plan whose entitlements the code grants", () => {
    expect(TRIAL_CODE_PLAN_NAME).toBe(PLANS.agency.name);
  });

  it("the SMS info tip names the texting plans from the price book", () => {
    const body = INFO_CONTENT["settings-sms"].body.join(" ");
    // Every platform plan carries team text alerts; the CRM's Essentials, Max and Elite do too.
    expect(body).toContain(TEXTING_PLANS);
    expect(TEXTING_PLANS).toBe("Solo, Team, Pro, Agency and Unlimited");
    expect(body).toContain(CRM_TEXTING_PLANS);
    expect(body).toContain(`${CLIENT_NUMBER_INCLUDED_PLANS} include at least one number`);
    expect(CLIENT_NUMBER_INCLUDED_PLANS).toBe("CRM Max, CRM Elite, Agency and Unlimited");
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

  it("the Terms are dated October 7, 2026 and list plans from the price book", () => {
    const src = read("client/src/pages/terms-of-use.tsx");
    expect(src).toContain('const LAST_UPDATED = "October 7, 2026"');
    // The CRM is a separate product (owner, 2026-10-07): the Terms never say a plan includes it.
    expect(src).not.toMatch(/CRM is included/i);
    expect(src).toContain("is a separate product with its own subscription plans");
    expect(src).toContain("PLAN_KEYS.map");
    expect(src).toContain("PLATFORM_ADDONS");
    expect(src).not.toMatch(/Individual Tool Pricing/);
  });

  it("the Competitor Intel page asks the server, not the client, for the plan", () => {
    const src = read("client/src/pages/competitors.tsx");
    expect(src).not.toContain("/api/stripe/subscription");
    expect(src).toContain('code !== "plan_required"');
  });
});
