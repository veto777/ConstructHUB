/**
 * Plan and price wording for pages, prompts and emails outside the pricing
 * page. Every number here is read from the price book (shared/plans.ts), so
 * copy can never drift from what checkout and entitlements enforce.
 */
import {
  PLANS, PLAN_KEYS, ADDONS, AGENCY_LOCATION_BANDS, AGENCY_SELF_SERVE_MAX_LOCATIONS,
  TRIAL_DAYS, SALES_THRESHOLD_CENTS, MODULE_NAMES, ANNUAL_MONTHS, planForModule, showsPrice,
  CALL_ASSISTANT_TIERS, CALL_ASSISTANT_NAME, CALL_ASSISTANT_FREE_SPAM_CALLS, CALL_ASSISTANT_ESTIMATE_MINUTES_PER_CALL,
  CALL_ASSISTANT_OVERAGE_RATES, callAssistantTier,
  type Plan, type PlanKey, type ModuleKey, type CallAssistantTier, type CallAssistantTierKey, type AddonKey,
} from "./plans";
import { CRM_PLANS, CRM_PLAN_KEYS, CRM_TRIAL_DAYS } from "./crm-plans";

/** "Talk to a sales rep" — the label for anything at or above SALES_THRESHOLD_CENTS. */
export const SALES_REP_LABEL = "Talk to a sales rep";
/** Where a sales conversation starts: the services section of the pricing page (inquiry form). */
export const SALES_HREF = "/pricing#services";

/** Cents to "$29", "$1,990" or "$0.02". */
export function formatUsd(cents: number): string {
  const whole = cents % 100 === 0;
  return "$" + (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** A price when it is under the sales threshold, otherwise the sales-rep label. */
export function priceOrSalesRep(cents: number): string {
  return showsPrice(cents) ? formatUsd(cents) : SALES_REP_LABEL;
}

/** "Pro", "Pro and Growth", "Pro, Growth and Agency". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Plan keys, cheapest first, whose plan satisfies `test`. */
export function plansWhere(test: (plan: Plan) => boolean): PlanKey[] {
  return PLAN_KEYS.filter((key) => test(PLANS[key]));
}

/** Plan names, cheapest first, whose plan satisfies `test` ("Pro, Growth and Agency"). */
export function planNamesWhere(test: (plan: Plan) => boolean): string {
  return joinNames(plansWhere(test).map((key) => PLANS[key].name));
}

/** The cheapest plan's monthly price. */
export const STARTING_MONTHLY_CENTS = Math.min(...PLAN_KEYS.map((key) => PLANS[key].monthlyCents));

/** "1-day trial". */
export const TRIAL_LABEL = `${TRIAL_DAYS}-day trial`;

/** "$1,000". */
export const SALES_THRESHOLD_LABEL = formatUsd(SALES_THRESHOLD_CENTS);

/** "$29/month or $290/year". */
export function planPriceLine(key: PlanKey): string {
  const plan = PLANS[key];
  return `${formatUsd(plan.monthlyCents)}/month or ${formatUsd(plan.annualCents)}/year`;
}

/** "CRM Basic 1, CRM Essentials 5 and CRM Max 8" — the CRM is its own product. */
export const CRM_SEATS_LINE = joinNames(CRM_PLAN_KEYS.map((key) => `${CRM_PLANS[key].name} ${CRM_PLANS[key].limits.seats}`));

/** Module names that only the Agency plan includes, in display order. */
export const AGENCY_ONLY_MODULES: string[] = (Object.keys(MODULE_NAMES) as ModuleKey[])
  .filter((module) => planForModule(module) === "agency")
  .map((module) => MODULE_NAMES[module]);

/** Graduated Agency location bands: "$15/month each for locations 11–50, …". */
export function agencyBandsLine(): string {
  const parts: string[] = [];
  let from = 1;
  for (const band of AGENCY_LOCATION_BANDS) {
    if (band.centsPerLocation > 0) {
      parts.push(`${formatUsd(band.centsPerLocation)}/month each for locations ${from}–${band.upTo}`);
    }
    from = band.upTo + 1;
  }
  return `${joinNames(parts)}; above ${AGENCY_SELF_SERVE_MAX_LOCATIONS} locations the Agency plan is quoted by a sales rep`;
}

/** The same bands billed yearly (ANNUAL_MONTHS × the monthly band price): "$150/year each for locations 11–50, …". */
function agencyBandsAnnualLine(): string {
  const parts: string[] = [];
  let from = 1;
  for (const band of AGENCY_LOCATION_BANDS) {
    if (band.centsPerLocation > 0) {
      parts.push(`${formatUsd(band.centsPerLocation * ANNUAL_MONTHS)}/year each for locations ${from}–${band.upTo}`);
    }
    from = band.upTo + 1;
  }
  return joinNames(parts);
}

/** "Extra location — $19/month or $190/year (Starter, Pro and Growth)". */
export function addonLines(): string[] {
  return Object.values(ADDONS).map((addon) => {
    const setup = addon.setupCents ? ` plus a ${formatUsd(addon.setupCents)} one-time setup fee` : "";
    const on = joinNames(addon.availableOn.map((key) => PLANS[key].name));
    const intro = addon.introMonthlyCents ? ` Launch price: ${callAssistantIntroLine()} (the intro is for monthly billing).` : "";
    // A `preview` add-on is listed but refused at checkout (shared/plans.ts), so say so.
    const preview = addon.preview ? " Coming soon: listed, not for sale yet." : "";
    return `${addon.name} — ${formatUsd(addon.monthlyCents)}/month or ${formatUsd(addon.annualCents)}/year${setup} (${on}). ${addon.description}${intro}${preview}`;
  });
}

// ── AI Call Assistant ────────────────────────────────────────────────────────

/**
 * AI Call Assistant pricing — four tiers (owner, 2026-10-02), every figure
 * from the price book (shared/plans.ts CALL_ASSISTANT_TIERS, the same table
 * the add-ons, Stripe prices and entitlements are built from):
 *
 *   Lite  — the smallest tier, no intro;
 *   Solo  — the launch intro "$99 a month for the first 3 months" (monthly
 *           billing only), then its monthly price — or its own yearly price;
 *   Crew, Fleet — more minutes and numbers, a lower overage per minute, no intro;
 *   every tier — its own overage per minute, extra numbers, and
 *           CALL_ASSISTANT_FREE_SPAM_CALLS spam calls a month that never count.
 *
 * Yearly prices are add-on annual prices, so they show even above the sales
 * threshold (like the plans' own annual prices). Every surface renders through
 * the helpers below: the landing page, /call-assistant, the pricing page, the
 * CRM Overview, Settings and Gabe's knowledge.
 */
const SOLO = callAssistantTier("solo");
const CHEAPEST = CALL_ASSISTANT_TIERS[0];

/** The Solo tier's launch intro (the only intro; monthly billing, first time the service is added). */
export const CALL_ASSISTANT_INTRO: { readonly monthlyCents: number; readonly months: number } = {
  monthlyCents: SOLO.introMonthlyCents ?? SOLO.monthlyCents,
  months: SOLO.introMonths ?? 0,
};

/** "Pro, Growth and Agency" — the plans the tiers are sold on. */
export const CALL_ASSISTANT_PLANS = joinNames(ADDONS[SOLO.addon].availableOn.map((key) => PLANS[key].name));

const count = (n: number) => n.toLocaleString("en-US");
const numbersLabel = (n: number) => `${n} local number${n === 1 ? "" : "s"}`;
/** Calls a month the tier's minutes cover at the assumed average call length — an estimate, rounded. */
const estimatedCalls = (t: CallAssistantTier) => Math.round(t.includedMinutes / CALL_ASSISTANT_ESTIMATE_MINUTES_PER_CALL / 50) * 50;

export type CallAssistantTierFacts = {
  tier: CallAssistantTierKey;
  addon: AddonKey;
  /** "Solo". */
  name: string;
  /** "AI Call Assistant — Solo" (the add-on's name). */
  fullName: string;
  monthly: string;
  annual: string;
  monthlyCents: number;
  annualCents: number;
  /** Solo only: "$99" for the first `introMonths` months on monthly billing. */
  intro: string | null;
  introMonths: number | null;
  minutes: string;
  includedMinutes: number;
  numbers: number;
  numbersLabel: string;
  /** "about 1,000 calls a month" at CALL_ASSISTANT_ESTIMATE_MINUTES_PER_CALL. */
  estimatedCalls: string;
  /** A minute above the included ones: "$0.05", "5¢" and the cents. */
  overage: string;
  overageShort: string;
  overageCents: number;
  /** Below the highest overage rate (Crew and Fleet): the cards badge it. */
  lowerOverage: boolean;
};

/** "10¢" — a per-minute rate under a dollar, the short form for tier cards. */
export function formatCentsShort(cents: number): string {
  return cents < 100 ? `${cents}¢` : formatUsd(cents);
}

/** Every tier, cheapest first, formatted. */
export function callAssistantTiers(): CallAssistantTierFacts[] {
  return CALL_ASSISTANT_TIERS.map((t) => ({
    tier: t.tier, addon: t.addon, name: t.name, fullName: ADDONS[t.addon].name,
    monthly: formatUsd(t.monthlyCents), annual: formatUsd(t.annualCents), monthlyCents: t.monthlyCents, annualCents: t.annualCents,
    intro: t.introMonthlyCents ? formatUsd(t.introMonthlyCents) : null, introMonths: t.introMonthlyCents ? t.introMonths ?? null : null,
    minutes: count(t.includedMinutes), includedMinutes: t.includedMinutes,
    numbers: t.includedNumbers, numbersLabel: numbersLabel(t.includedNumbers),
    estimatedCalls: `about ${count(estimatedCalls(t))} calls a month`,
    overage: formatUsd(t.overageCentsPerMinute), overageShort: formatCentsShort(t.overageCentsPerMinute), overageCents: t.overageCentsPerMinute,
    lowerOverage: t.overageCentsPerMinute < CALL_ASSISTANT_OVERAGE_RATES[0],
  }));
}

/** The tiers grouped by overage rate, highest rate first: [[10, ["Lite", "Solo"]], [5, ["Crew", "Fleet"]]]. */
function overageGroups(): [number, string[]][] {
  return CALL_ASSISTANT_OVERAGE_RATES.map((rate) => [rate, CALL_ASSISTANT_TIERS.filter((t) => t.overageCentsPerMinute === rate).map((t) => t.name)]);
}

/** "$0.10 a minute on Lite and Solo, $0.05 on Crew and Fleet" — the overage, per tier, from the price book. */
export function callAssistantOverageLine(): string {
  return overageGroups().map(([rate, names], i) => `${formatUsd(rate)}${i === 0 ? " a minute" : ""} on ${joinNames(names)}`).join(", ");
}

/** Every Call Assistant price fact, formatted, for page copy. `intro`/`regular`/`annual` are Solo's (the entry tier). */
export function callAssistantPricing() {
  const solo = ADDONS[SOLO.addon];
  return {
    name: CALL_ASSISTANT_NAME,
    intro: formatUsd(CALL_ASSISTANT_INTRO.monthlyCents),
    introMonths: CALL_ASSISTANT_INTRO.months,
    /** Solo's monthly price after the intro. */
    regular: formatUsd(solo.monthlyCents),
    /** Solo's annual price (no intro on annual billing). */
    annual: formatUsd(solo.annualCents),
    /** Solo's numbers and minutes. */
    includedNumbers: SOLO.includedNumbers,
    includedMinutes: count(SOLO.includedMinutes),
    /** "four" — how many tiers, as a word for headings. */
    tierCountWord: ["zero", "one", "two", "three", "four", "five", "six"][CALL_ASSISTANT_TIERS.length] ?? String(CALL_ASSISTANT_TIERS.length),
    /**
     * The cheapest tier's REGULAR monthly price and name ($149, Lite). Solo's intro ($99 for 3 months) is
     * lower, so copy says "Regular prices from $149/mo", never a bare "From $149/mo" next to the intro.
     */
    from: formatUsd(CHEAPEST.monthlyCents),
    fromTier: CHEAPEST.name,
    /** "$0.10 a minute on Lite and Solo, $0.05 on Crew and Fleet" — overage is per tier. */
    overageLine: callAssistantOverageLine(),
    extraNumber: formatUsd(ADDONS.call_number.monthlyCents),
    /** "500" — spam calls a month that never count toward minutes, every tier. */
    freeSpamCalls: count(CALL_ASSISTANT_FREE_SPAM_CALLS),
    plans: CALL_ASSISTANT_PLANS,
    planKeys: solo.availableOn,
    tiers: callAssistantTiers(),
    /** Listed but not for sale yet (the numbers+billing lane drops the flag at launch). */
    comingSoon: CALL_ASSISTANT_TIERS.every((t) => ADDONS[t.addon].preview === true),
  };
}

/** "$99/month for your first 3 months, then $249/month — or $1,999/year" — Solo's launch price. */
export function callAssistantIntroLine(): string {
  const p = callAssistantPricing();
  return `${p.intro}/month for your first ${p.introMonths} months, then ${p.regular}/month — or ${p.annual}/year`;
}

/** "$99/mo for your first 3 months, then $249/mo — or $1,999/yr" — Solo's launch price, the short form next to a price. */
export function callAssistantIntroShort(): string {
  const p = callAssistantPricing();
  return `${p.intro}/mo for your first ${p.introMonths} months, then ${p.regular}/mo — or ${p.annual}/yr`;
}

/** "Lite $149/month or $1,199/year (1,000 minutes a month and 1 local number, then $0.10 a minute), Solo …, Crew … and Fleet …". */
export function callAssistantTiersLine(): string {
  return joinNames(callAssistantTiers().map((t) => `${t.name} ${t.monthly}/month or ${t.annual}/year (${t.minutes} minutes a month and ${t.numbersLabel}, then ${t.overage} a minute)`));
}

/** "Lite $149/month (1,000 minutes), Solo $249/month (2,000 minutes), …" — the short form, for answers with a length cap. */
export function callAssistantTiersShortLine(): string {
  return joinNames(callAssistantTiers().map((t) => `${t.name} ${t.monthly}/month (${t.minutes} minutes)`));
}

/**
 * "Yearly: Solo $1,999/yr, Crew $3,599/yr and Fleet $6,399/yr when your plan
 * is billed yearly (add-ons follow your plan's billing); the $99/mo intro for
 * your first 3 months is Solo on monthly billing" — add-ons always ride on the
 * plan's interval (server/billing/order.ts), so yearly is never a choice for
 * the add-on alone.
 */
export function callAssistantYearlyNote(): string {
  const p = callAssistantPricing();
  const yearly = joinNames(p.tiers.map((t) => `${t.name} ${t.annual}/yr`));
  return `${yearly} when your plan is billed yearly (add-ons follow your plan's billing); the ${p.intro}/mo intro for your first ${p.introMonths} months is ${SOLO.name} on monthly billing`;
}

/**
 * What happens to the number and the assistant when billing stops — the
 * owner's rules (2026-10-02), in one place for the FAQ, the Studio Numbers
 * tab and Gabe: your own numbers are never moved; the assistant's number is
 * part of the service and is released if you cancel; a failed payment pauses
 * the assistant until the card is updated.
 */
export const CALL_ASSISTANT_NUMBER_RULES = {
  ownNumbers: "Your existing business numbers are never moved: you keep them with your phone company and forward them to the assistant.",
  cancel: "The Call Assistant number is part of the service. If you cancel, it is released and stops working, so turn off forwarding to it first.",
  payment: "If a payment fails, the assistant pauses until the card is updated in Settings → Billing; the number is held while the payment is retried.",
} as const;

/**
 * The spam filter, in the words every surface uses (owner, 2026-10-02: "they
 * don't ever have to answer spam … our system blocks spam calls and reports
 * them"). Only what the code does: the assistant screens each call it answers
 * (server/voice/internal-calls.ts), a spam call notifies nobody and files no
 * lead, a number with two near-certain spam strikes (server/voice/spam.ts:
 * confidence ≥ strikeAt, SPAM_STRIKES_TO_BLOCK) is rejected before the call
 * is answered (the engine's <Reject/>), every one is listed in the Calls tab's
 * spam view and the weekly spam report to the customer
 * (server/voice/spam-report.ts — nothing is reported to carriers or
 * registries), and the first CALL_ASSISTANT_FREE_SPAM_CALLS a month never
 * count toward minutes. The promise holds on calls forwarded to the
 * assistant: with no-answer forwarding a spam call still rings the
 * contractor first (`forwarding` says so, and how to fix it).
 */
export const CALL_ASSISTANT_SPAM = {
  headline: "You never answer a spam call again",
  lead: "Forward your line to your assistant and it answers every call first, so spam stops with it, not with you.",
  screen: "Telemarketers, robocalls and cold sales pitches are flagged as spam: on calls forwarded to your assistant they never reach you, never create a lead and never notify anyone.",
  block: "A number caught twice as near-certain spam is blocked: its next calls to your assistant are rejected before they're answered and never cost a minute.",
  forwarding: "With no-answer or after-hours forwarding, spam still rings you first. Switch to 'always' forwarding to stop answering spam.",
  report: "Every spam call and blocked number lands in your spam report under Calls → Spam blocked, with one click to unblock a number we got wrong, and a weekly email tells you how many spam calls were stopped.",
} as const;

/** The step title for the block rule (two near-certain strikes, server/voice/spam.ts). */
export const CALL_ASSISTANT_SPAM_BLOCK_TITLE = "Two strikes, blocked before it's answered";

/** "the first 500 spam calls each month never count toward your minutes, on every tier" — after that, spam minutes count like any call. */
export function callAssistantSpamAllowanceLine(): string {
  return `the first ${count(CALL_ASSISTANT_FREE_SPAM_CALLS)} spam calls each month never count toward your minutes, on every tier`;
}

/** "Lite includes 1 local number, Solo 1, Crew 5 and Fleet 20" — local numbers per tier, from the price book. */
export function callAssistantTierNumbersLine(): string {
  const [first, ...rest] = callAssistantTiers();
  return joinNames([`${first.name} includes ${first.numbersLabel}`, ...rest.map((t) => `${t.name} ${t.numbers}`)]);
}

/** "minutes above a tier's included ones are $0.10 a minute on Lite and Solo, $0.05 on Crew and Fleet; extra numbers $5/month each; the first 500 spam calls …". */
export function callAssistantIncludesLine(): string {
  const p = callAssistantPricing();
  return `minutes above a tier's included ones are ${p.overageLine}; extra numbers are ${p.extraNumber}/month each; and ${callAssistantSpamAllowanceLine()}`;
}

/** How overage is billed — for the FAQ, Limits & usage and Gabe. Each call at the rate of the tier it was taken on. */
export function callAssistantOverageRule(): string {
  return `Each tier includes its minutes every calendar month. Above them, it's ${callAssistantOverageLine()}, on your next invoice. Each call is billed at the rate of the tier you're on when it ends, so a mid-month change of tier never reprices calls already taken.`;
}

/** What counts as a minute — for the FAQ and Gabe. */
export function callAssistantMinuteRule(): string {
  return "Every started minute of a call the assistant answers counts, the way phone carriers bill. Calls from a blocked number are rejected before answering and use no minutes.";
}

/** Which tier fits, as estimates (calls of about CALL_ASSISTANT_ESTIMATE_MINUTES_PER_CALL minutes). */
export function callAssistantTierAdvice(): string {
  const tiers = callAssistantTiers();
  const groups = overageGroups();
  const lower = groups.length > 1 ? ` On ${joinNames(groups[groups.length - 1][1])}, minutes above the included ones also cost less: ${formatUsd(groups[groups.length - 1][0])} a minute instead of ${formatUsd(groups[0][0])}.` : "";
  return `At about ${CALL_ASSISTANT_ESTIMATE_MINUTES_PER_CALL} minutes a call, ${joinNames(tiers.map((t) => `${t.name} covers ${t.estimatedCalls}`))}.${lower} These are estimates: your calls may run shorter or longer, and you can move between tiers any time in Settings → Billing.`;
}

/**
 * Whether the add-on can be bought today, in Gabe's words. The price book's
 * `preview` flag decides, so the knowledge pack and the preset answers stay
 * honest without a copy change.
 */
export function callAssistantAvailabilityLine(): string {
  return callAssistantPricing().comingSoon
    ? "It is coming soon: it is listed on Pricing but is not for sale yet, and there is no launch date to give. Create an account now and add it from Settings → Billing once it is live."
    : `Add it from Settings → Billing on the ${CALL_ASSISTANT_PLANS} plans.`;
}

/** Add-ons whose yearly price is their own, not ANNUAL_MONTHS × monthly: ", except the AI Call Assistant, which is $1,999/year". */
function annualExceptionsLine(): string {
  const odd = Object.values(ADDONS).filter((a) => a.annualCents !== a.monthlyCents * ANNUAL_MONTHS);
  if (!odd.length) return "";
  return `, except ${joinNames(odd.map((a) => `the ${a.name}, which is ${formatUsd(a.annualCents)}/year`))}`;
}

/** Competitor Intel is on every plan with a monthly scan allowance. */
export const COMPETITOR_INTEL_PLANS = planNamesWhere((plan) => plan.limits.competitorScans > 0);
/** Click Guard + IP Tracker + VPN Shield come with every plan that protects at least one site. */
export const PROTECTED_SITE_PLANS = planNamesWhere((plan) => plan.limits.protectedSites > 0);
/** Plans with team text alerts. */
export const TEXTING_PLANS = planNamesWhere((plan) => plan.limits.teamTextSegments > 0);
/** CRM plans with texting — the CRM is a separate product (shared/crm-plans.ts). */
export const CRM_TEXTING_PLANS = joinNames(CRM_PLAN_KEYS.filter((k) => CRM_PLANS[k].limits.teamTextSegments > 0).map((k) => CRM_PLANS[k].name));
/** "CRM Basic $39/month or $348/year (1 seat), …" */
export const crmPlansLine = () => CRM_PLAN_KEYS.map((k) => {
  const p = CRM_PLANS[k];
  return `${p.name} ${formatUsd(p.monthlyCents)}/month or ${formatUsd(p.annualCents)}/year (${p.limits.seats} seat${p.limits.seats === 1 ? "" : "s"})`;
}).join("; ");

/**
 * The price book as plain text for the AI assistants' system prompts. It lists
 * only what shared/plans.ts sells, and tells the model to send anything priced
 * at the sales threshold or above to a sales rep instead of quoting it.
 */
export function pricingKnowledge(): string {
  const plans = PLAN_KEYS.map((key) => {
    const plan = PLANS[key];
    const agency = key === "agency"
      ? ` Locations above ${plan.limits.locations}: ${agencyBandsLine()}. On yearly billing each extra location is ${ANNUAL_MONTHS} times its monthly band price: ${agencyBandsAnnualLine()}.`
      : "";
    return `- **${plan.name}** — ${planPriceLine(key)}. ${plan.tagline}${agency}\n  Includes: ${plan.features.join("; ")}.`;
  }).join("\n");
  return `## Plans and pricing (the ConstructHUB price book)
There is no free plan. A new subscription starts with a ${TRIAL_LABEL}. Plans are billed monthly, or yearly at ${ANNUAL_MONTHS} times the monthly price. The ${PLANS.agency.name} location bands and every add-on are billed the same way: monthly, or yearly at ${ANNUAL_MONTHS} times their monthly price${annualExceptionsLine()}.
${plans}

Only the ${PLANS.agency.name} plan includes: ${joinNames(AGENCY_ONLY_MODULES)}.
The CRM (clients, estimates, invoices, payments, pipeline) is a SEPARATE product with its own subscription: none of the plans above includes it, and a CRM subscription does not include the tools above. CRM pricing: ${crmPlansLine()}. A first CRM subscription starts with a ${CRM_TRIAL_DAYS}-day trial.
Competitor Intel is included with ${COMPETITOR_INTEL_PLANS}. Click Guard, IP Tracker and VPN Shield are included with ${PROTECTED_SITE_PLANS}. Texting is included with ${TEXTING_PLANS}.

### Add-ons (single features are sold only as add-ons to a plan)
${addonLines().map((line) => `- ${line}`).join("\n")}

### Services and anything priced at ${SALES_THRESHOLD_LABEL} or more
SEO programs, website builds, business formation and contractor licensing, the Complete Business Build, the Master Class modules and bundle, and custom work are quoted by a sales rep. Never state a price for them — say "${SALES_REP_LABEL}" and point to the services section of the Pricing page (${SALES_HREF}).
Do not describe, name or price any product, plan, package or discount that is not listed in this price book. If you are not sure something is sold, say so and suggest the visitor ${SALES_REP_LABEL.toLowerCase()}.`;
}
