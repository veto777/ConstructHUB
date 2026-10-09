/**
 * Plan and price wording for pages, prompts and emails outside the pricing
 * page. Every number here is read from the price book (shared/plans.ts), so
 * copy can never drift from what checkout and entitlements enforce.
 */
import {
  PLANS, PLAN_KEYS, ADDONS,
  TRIAL_DAYS, SALES_THRESHOLD_CENTS, MODULE_NAMES, ANNUAL_MONTHS, planForModule, showsPrice,
  CALL_ASSISTANT_TIERS, CALL_ASSISTANT_NAME, CALL_ASSISTANT_FREE_SPAM_CALLS, CALL_ASSISTANT_ESTIMATE_MINUTES_PER_CALL,
  CALL_ASSISTANT_OVERAGE_RATES, CALL_ASSISTANT_OVERAGE_CENTS_PER_MINUTE, CALL_ASSISTANT_ANNUAL_MONTHS, CALL_ASSISTANT_FROM_CENTS, CALL_ASSISTANT_PRICING_HREF, isCallAssistantAddon,
  type Plan, type PlanKey, type ModuleKey, type CallAssistantTier, type CallAssistantTierKey, type AddonKey, type Addon,
} from "./plans";
import { CRM_ADDONS, CRM_EXTRA_SEAT_ANNUAL_CENTS, CRM_EXTRA_SEAT_MONTHLY_CENTS, CRM_PLANS, CRM_PLAN_KEYS, CRM_TRIAL_DAYS } from "./crm-plans";

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

/** "Pro", "Pro and Agency", "Pro, Agency and Unlimited". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Plan keys, cheapest first, whose plan satisfies `test`. */
export function plansWhere(test: (plan: Plan) => boolean): PlanKey[] {
  return PLAN_KEYS.filter((key) => test(PLANS[key]));
}

/** Plan names, cheapest first, whose plan satisfies `test` ("Pro, Agency and Unlimited"). */
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

/** The cheapest CRM plan (the CRM is a separate product: shared/crm-plans.ts) — for "CRM plans from $X". */
export const CRM_STARTING_PLAN = CRM_PLANS[CRM_PLAN_KEYS.reduce((a, b) => (CRM_PLANS[b].monthlyCents < CRM_PLANS[a].monthlyCents ? b : a))];
/** "$39/mo" — the lowest CRM plan price, for "its own plans, from $39/mo". */
export const CRM_FROM_PRICE = `${formatUsd(CRM_STARTING_PLAN.monthlyCents)}/mo`;

/** "CRM Basic 1, CRM Essentials 5 and CRM Max 8" — the CRM is its own product. */
export const CRM_SEATS_LINE = joinNames(CRM_PLAN_KEYS.map((key) => `${CRM_PLANS[key].name} ${CRM_PLANS[key].limits.seats}`));

/** Module names that only the Agency plan includes, in display order. */
export const AGENCY_ONLY_MODULES: string[] = (Object.keys(MODULE_NAMES) as ModuleKey[])
  .filter((module) => planForModule(module) === "agency")
  .map((module) => MODULE_NAMES[module]);

/** The platform's own add-ons: not the AI Call Assistant's (its own subscription) and not retired lines
 * (an add-on sold on no plan and not a preview, like the old extra-location one, reads stored subscriptions only). */
export const PLATFORM_ADDONS: readonly Addon[] = Object.values(ADDONS).filter(
  (a) => !isCallAssistantAddon(a.key) && (a.availableOn.length > 0 || a.preview === true),
);

/** "Grid scan pack — $10/month or $100/year (Solo, Team, Pro, Agency, Unlimited)" — the platform's add-ons. */
export function addonLines(): string[] {
  return PLATFORM_ADDONS.map((addon) => {
    const setup = addon.setupCents ? ` plus a ${formatUsd(addon.setupCents)} one-time setup fee` : "";
    const on = joinNames(addon.availableOn.map((key) => PLANS[key].name));
    // A `preview` add-on is listed but refused at checkout (shared/plans.ts), so say so.
    const preview = addon.preview ? " Coming soon: listed, not for sale yet." : "";
    // The SEO suites' names and descriptions are SEO-topic, and the Hub's filter reads any amount
    // in an SEO-topic sentence under the stricter SEO price rule (O10/O9): a bare plan list gives
    // no add-on cue, so word their availability as "sold as an add-on on …" to keep the listed
    // prices quotable there.
    const onClause = addon.exclusiveGroup === "seo_addon" ? `, sold as an add-on on ${on}` : ` (${on})`;
    return `${addon.name} — ${formatUsd(addon.monthlyCents)}/month or ${formatUsd(addon.annualCents)}/year${setup}${onClause}. ${addon.description}${preview}`;
  });
}

// ── AI Call Assistant ────────────────────────────────────────────────────────

/**
 * AI Call Assistant pricing — a SEPARATE SERVICE on its own subscription
 * (owner, 2026-10-08), four tiers, every figure from the price book
 * (shared/plans.ts CALL_ASSISTANT_TIERS, the same table the Stripe prices and
 * the entitlements are built from): a tier's minutes and local numbers a
 * month, one overage rate on every tier, yearly billing at
 * CALL_ASSISTANT_ANNUAL_MONTHS × monthly (one month free), no intro price, and
 * CALL_ASSISTANT_FREE_SPAM_CALLS spam calls a month that never count. Above the
 * top tier there is no listed price: "Talk to a sales rep". Yearly prices are
 * the service's own prices, so they show even above the sales threshold (like
 * the plans' yearly prices). Every surface renders through the helpers below:
 * the landing page, /call-assistant, the pricing page, the Call Assistant's
 * Overview, Settings and Gabe's knowledge.
 */
const CHEAPEST = CALL_ASSISTANT_TIERS[0];
const TOP = CALL_ASSISTANT_TIERS[CALL_ASSISTANT_TIERS.length - 1];

/** "$249/mo" — the cheapest tier's monthly price, for "a separate service, from $249/mo". */
export const CALL_ASSISTANT_FROM_PRICE = `${formatUsd(CALL_ASSISTANT_FROM_CENTS)}/mo`;
/** How many months yearly billing gives free: 12 − CALL_ASSISTANT_ANNUAL_MONTHS. */
export const CALL_ASSISTANT_ANNUAL_FREE_MONTHS = 12 - CALL_ASSISTANT_ANNUAL_MONTHS;
/** The one sentence every surface uses for how the service is sold. */
export const CALL_ASSISTANT_SEPARATE_LINE = `The ${CALL_ASSISTANT_NAME} is a separate service with its own subscription, from ${CALL_ASSISTANT_FROM_PRICE}: no ConstructHUB plan includes it, and none is needed to buy it.`;

const count = (n: number) => n.toLocaleString("en-US");
const numbersLabel = (n: number) => `${n} local number${n === 1 ? "" : "s"}`;
/** Calls a month the tier's minutes cover at the assumed average call length — an estimate, rounded. */
const estimatedCalls = (t: CallAssistantTier) => Math.round(t.includedMinutes / CALL_ASSISTANT_ESTIMATE_MINUTES_PER_CALL / 50) * 50;

export type CallAssistantTierFacts = {
  tier: CallAssistantTierKey;
  addon: AddonKey;
  /** "500 minutes" — the tier is named by the minutes it includes. */
  name: string;
  /** "AI Call Assistant — 500 minutes" (the add-on's name). */
  fullName: string;
  monthly: string;
  annual: string;
  monthlyCents: number;
  annualCents: number;
  minutes: string;
  includedMinutes: number;
  numbers: number;
  numbersLabel: string;
  /** "about 250 calls a month" at CALL_ASSISTANT_ESTIMATE_MINUTES_PER_CALL. */
  estimatedCalls: string;
  /** A minute above the included ones: "$0.50", "50¢" and the cents. */
  overage: string;
  overageShort: string;
  overageCents: number;
};

/** "50¢" — a per-minute rate under a dollar, the short form for tier cards. */
export function formatCentsShort(cents: number): string {
  return cents < 100 ? `${cents}¢` : formatUsd(cents);
}

/** Every tier, cheapest first, formatted. */
export function callAssistantTiers(): CallAssistantTierFacts[] {
  return CALL_ASSISTANT_TIERS.map((t) => ({
    tier: t.tier, addon: t.addon, name: t.name, fullName: ADDONS[t.addon].name,
    monthly: formatUsd(t.monthlyCents), annual: formatUsd(t.annualCents), monthlyCents: t.monthlyCents, annualCents: t.annualCents,
    minutes: count(t.includedMinutes), includedMinutes: t.includedMinutes,
    numbers: t.includedNumbers, numbersLabel: numbersLabel(t.includedNumbers),
    estimatedCalls: `about ${count(estimatedCalls(t))} calls a month`,
    overage: formatUsd(t.overageCentsPerMinute), overageShort: formatCentsShort(t.overageCentsPerMinute), overageCents: t.overageCentsPerMinute,
  }));
}

/** The tiers grouped by overage rate, highest rate first: [[50, [every tier]]] today. */
function overageGroups(): [number, string[]][] {
  return CALL_ASSISTANT_OVERAGE_RATES.map((rate) => [rate, CALL_ASSISTANT_TIERS.filter((t) => t.overageCentsPerMinute === rate).map((t) => t.name)]);
}

/** "$0.50 a minute on every tier" — the overage, from the price book (per tier, should the rates ever differ again). */
export function callAssistantOverageLine(): string {
  const groups = overageGroups();
  if (groups.length === 1) return `${formatUsd(groups[0][0])} a minute on every tier`;
  return groups.map(([rate, names], i) => `${formatUsd(rate)}${i === 0 ? " a minute" : ""} on ${joinNames(names)}`).join(", ");
}

/** "More than 5,000 minutes a month is quoted by a sales rep: there is no listed price above the 5,000 minutes tier." */
export function callAssistantAboveTopLine(): string {
  return `More than ${count(TOP.includedMinutes)} minutes a month is quoted by a sales rep (${SALES_REP_LABEL}): there is no listed price above the ${TOP.name} tier.`;
}

/** Every Call Assistant price fact, formatted, for page copy. */
export function callAssistantPricing() {
  return {
    name: CALL_ASSISTANT_NAME,
    /** "four" — how many tiers, as a word for headings. */
    tierCountWord: ["zero", "one", "two", "three", "four", "five", "six"][CALL_ASSISTANT_TIERS.length] ?? String(CALL_ASSISTANT_TIERS.length),
    /** The cheapest tier's monthly price and name ($249, 500 minutes): "from $249/mo". */
    from: formatUsd(CHEAPEST.monthlyCents),
    fromTier: CHEAPEST.name,
    fromPrice: CALL_ASSISTANT_FROM_PRICE,
    /** The top tier: the most that is listed; above it, a sales rep. */
    top: formatUsd(TOP.monthlyCents),
    topTier: TOP.name,
    topMinutes: count(TOP.includedMinutes),
    /** Yearly = this many monthly prices (one month free). */
    annualMonths: CALL_ASSISTANT_ANNUAL_MONTHS,
    annualFreeMonths: CALL_ASSISTANT_ANNUAL_FREE_MONTHS,
    /** "$0.50" — a minute above the included ones, every tier. */
    overage: formatUsd(CALL_ASSISTANT_OVERAGE_RATES[0]),
    overageLine: callAssistantOverageLine(),
    extraNumber: formatUsd(ADDONS.call_number.monthlyCents),
    extraNumberAnnual: formatUsd(ADDONS.call_number.annualCents),
    /** "500" — spam calls a month that never count toward minutes, every tier. */
    freeSpamCalls: count(CALL_ASSISTANT_FREE_SPAM_CALLS),
    separateLine: CALL_ASSISTANT_SEPARATE_LINE,
    pricingHref: CALL_ASSISTANT_PRICING_HREF,
    tiers: callAssistantTiers(),
    /** Listed but not for sale yet (every tier `preview` in the price book). */
    comingSoon: CALL_ASSISTANT_TIERS.every((t) => ADDONS[t.addon].preview === true),
  };
}

/**
 * "500 minutes a month with 1 local number for $249/month or $2,739/year, …;
 * above the included minutes, $0.50 a minute on every tier".
 */
export function callAssistantTiersLine(): string {
  const tiers = joinNames(callAssistantTiers().map((t) => `${t.minutes} minutes a month with ${t.numbersLabel} for ${t.monthly}/month or ${t.annual}/year`));
  return `${tiers}; above the included minutes, ${callAssistantOverageLine()}`;
}

/** "500 minutes $249/month, 1,000 minutes $349/month, …" — the short form, for answers with a length cap. */
export function callAssistantTiersShortLine(): string {
  return joinNames(callAssistantTiers().map((t) => `${t.name} ${t.monthly}/month`));
}

/**
 * "Yearly billing is 11 times the monthly price, so one month is free: 500
 * minutes $2,739/yr, …. The Call Assistant is billed on its own subscription,
 * apart from any plan." — the service's yearly rule (the plans use ANNUAL_MONTHS).
 */
export function callAssistantYearlyNote(): string {
  const yearly = joinNames(callAssistantTiers().map((t) => `${t.name} ${t.annual}/yr`));
  return `Yearly billing is ${CALL_ASSISTANT_ANNUAL_MONTHS} times the monthly price, so ${CALL_ASSISTANT_ANNUAL_FREE_MONTHS === 1 ? "one month is" : `${CALL_ASSISTANT_ANNUAL_FREE_MONTHS} months are`} free: ${yearly}. The ${CALL_ASSISTANT_NAME} is billed on its own subscription, apart from any plan`;
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

/** "the 500 minutes tier includes 1 local number, the 1,000 minutes tier 1, the 2,000 minutes tier 2 and the 5,000 minutes tier 5" — from the price book. */
export function callAssistantTierNumbersLine(): string {
  const [first, ...rest] = callAssistantTiers();
  return joinNames([`the ${first.name} tier includes ${first.numbersLabel}`, ...rest.map((t) => `the ${t.name} tier ${t.numbers}`)]);
}

/** "minutes above a tier's included ones are $0.50 a minute on every tier; extra numbers are $5/month each; and the first 500 spam calls …". */
export function callAssistantIncludesLine(): string {
  const p = callAssistantPricing();
  return `minutes above a tier's included ones are ${p.overageLine}; extra numbers are ${p.extraNumber}/month each; and ${callAssistantSpamAllowanceLine()}`;
}

/**
 * How overage is counted — for the FAQ, Limits & usage and Gabe: the rate, never a promise about when it is
 * charged (static copy cannot read the overage switch; callAssistantOverageStatusLine says what happens now).
 */
export function callAssistantOverageRule(): string {
  return `Each tier includes its minutes every calendar month. Above them, it's ${callAssistantOverageLine()}. Each call is counted at the rate in force when it ends, so a mid-month change of tier never reprices calls already taken.`;
}

/**
 * What happens to minutes above the plan RIGHT NOW, from the server's overage switch
 * (CALL_ASSISTANT_OVERAGE_BILLING, carried as `overageBilling` on the billing status): off — counted, shown,
 * not charged yet; on — charged at the rate on the next invoice. The rate words stay either way.
 */
export function callAssistantOverageStatusLine(state: "on" | "off" | null | undefined, centsPerMinute = CALL_ASSISTANT_OVERAGE_CENTS_PER_MINUTE): string {
  const rate = `${formatCentsShort(centsPerMinute)} a minute`;
  return state === "on"
    ? `Minutes above your plan are ${rate}, on your next invoice.`
    : `Minutes above your plan are counted but not charged yet; the rate is ${rate}.`;
}

/** What counts as a minute — for the FAQ and Gabe. */
export function callAssistantMinuteRule(): string {
  return "Every started minute of a call the assistant answers counts, the way phone carriers bill. Calls from a blocked number are rejected before answering and use no minutes.";
}

/** Which tier fits, as estimates (calls of about CALL_ASSISTANT_ESTIMATE_MINUTES_PER_CALL minutes); above the top tier, a sales rep. */
export function callAssistantTierAdvice(): string {
  const tiers = callAssistantTiers();
  return `At about ${CALL_ASSISTANT_ESTIMATE_MINUTES_PER_CALL} minutes a call, ${joinNames(tiers.map((t) => `${t.name} covers ${t.estimatedCalls}`))}. These are estimates: your calls may run shorter or longer, and you can move between tiers any time in Settings → Billing. ${callAssistantAboveTopLine()}`;
}

/**
 * Where and how the service is bought, in Gabe's words. The price book's
 * `preview` flag decides, so the knowledge pack and the preset answers stay
 * honest without a copy change.
 */
export function callAssistantAvailabilityLine(): string {
  return callAssistantPricing().comingSoon
    ? "It is coming soon: it is listed on Pricing but is not for sale yet, and there is no launch date to give. Create an account now and buy it from Pricing once it is live."
    : `Buy it on Pricing (${CALL_ASSISTANT_PRICING_HREF}) as its own subscription, with or without a ConstructHUB plan; change tiers any time in Settings → Billing.`;
}

/** Platform add-ons whose yearly price is their own, not ANNUAL_MONTHS × monthly (none today: the Call Assistant is its own service). */
export function annualExceptionsLine(): string {
  const odd = PLATFORM_ADDONS.filter((a) => a.annualCents !== a.monthlyCents * ANNUAL_MONTHS);
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
/** Every plan that carries texting, CRM plans first: "the CRM Essentials and CRM Max CRM plans, or the Pro, Growth and Agency platform plans" (server/crm/sms.ts accepts either). */
export const TEXTING_EITHER_LINE = `the ${CRM_TEXTING_PLANS} CRM plans, or the ${TEXTING_PLANS} platform plans`;
/** "CRM Essentials 500 and CRM Max 1,500" — team text segments a month on the CRM plans that have them. */
export const CRM_TEXT_SEGMENTS_LINE = joinNames(CRM_PLAN_KEYS.filter((k) => CRM_PLANS[k].limits.teamTextSegments > 0).map((k) => `${CRM_PLANS[k].name} ${CRM_PLANS[k].limits.teamTextSegments.toLocaleString("en-US")}`));
/** Plans that come with a client-texting number included, CRM plans first: "CRM Max, Agency and Unlimited". */
export const CLIENT_NUMBER_INCLUDED_PLANS = joinNames([
  ...CRM_PLAN_KEYS.filter((k) => CRM_PLANS[k].limits.clientTexting === "included").map((k) => CRM_PLANS[k].name),
  ...PLAN_KEYS.filter((k) => PLANS[k].limits.clientTexting === "included").map((k) => PLANS[k].name),
]);
/** The CRM's own add-ons and what they cost: JobCam (included in the plans that carry it) and extra seats. */
export function crmAddonsLine(): string {
  const jobcam = CRM_ADDONS.jobcam;
  const includedIn = CRM_PLAN_KEYS.filter((k) => CRM_PLANS[k].limits.jobcam).map((k) => CRM_PLANS[k].name);
  const addonOn = joinNames(jobcam.availableOn.map((k) => CRM_PLANS[k].name));
  return `${jobcam.name} (job photos and video) is ${includedIn.length ? `included in ${joinNames(includedIn)} and is ` : ""}an add-on on ${addonOn} at ${formatUsd(jobcam.monthlyCents)}/month or ${formatUsd(jobcam.annualCents)}/year. An extra CRM seat is ${formatUsd(CRM_EXTRA_SEAT_MONTHLY_CENTS)}/month or ${formatUsd(CRM_EXTRA_SEAT_ANNUAL_CENTS)}/year`;
}
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
    // Keep the owner's benefit wording on Pricing, but omit sales-only value annotations
    // from assistant prompts, which must send course-price questions to a sales rep.
    const features = plan.features.map((feature) => feature.replace(/\s*\(\$([\d,]+)\)/g,
      (note, dollars: string) => Number(dollars.replaceAll(",", "")) * 100 >= SALES_THRESHOLD_CENTS ? "" : note));
    // Each feature its own sentence: the filter reads a sales-only item next to any
    // amount in one sentence as quoting that item a price (O11), and a plan list can
    // carry both (the Unlimited plan includes the Master Class and lists its SEO data).
    return `- **${plan.name}** — ${planPriceLine(key)}. ${plan.tagline}\n  Includes: ${features.join(". ")}.`;
  }).join("\n");
  return `## Plans and pricing (the ConstructHUB price book)
There is no free plan. A new subscription starts with a ${TRIAL_LABEL}. Plans are billed monthly, or yearly at ${ANNUAL_MONTHS} times the monthly price. Every add-on is billed the same way: monthly, or yearly at ${ANNUAL_MONTHS} times its monthly price${annualExceptionsLine()}. Outgrow a plan's locations or seats and you move up a plan — there is no per-location pricing.
${plans}

Only the ${PLANS.agency.name} plan includes: ${joinNames(AGENCY_ONLY_MODULES)}.
The CRM (clients, estimates, invoices, payments, pipeline) is a SEPARATE product with its own subscription: none of the plans above includes it, and a CRM subscription does not include the tools above. CRM pricing: ${crmPlansLine()}. CRM yearly prices are their own, not ${ANNUAL_MONTHS} times the monthly price. A first CRM subscription starts with a ${CRM_TRIAL_DAYS}-day trial. ${crmAddonsLine()}.
The ${CALL_ASSISTANT_NAME} (an AI receptionist on a local number) is a SEPARATE SERVICE with its own subscription, not a plan add-on: none of the plans above or the CRM plans includes it, and no plan is needed to buy it. ${callAssistantPricing().tierCountWord.replace(/^./, (c) => c.toUpperCase())} tiers, one per account: ${callAssistantTiersLine()}. ${callAssistantYearlyNote()}. Extra local numbers are ${callAssistantPricing().extraNumber}/month each, and ${callAssistantSpamAllowanceLine()}. There is no intro or launch price. ${callAssistantAboveTopLine()}
Competitor Intel is included with ${COMPETITOR_INTEL_PLANS}. Click Guard, IP Tracker and VPN Shield are included with ${PROTECTED_SITE_PLANS}. Texting is sent from the CRM and is included with ${TEXTING_EITHER_LINE}.

### Add-ons (single features are sold only as add-ons to a plan; the AI Call Assistant is a separate service, above)
${addonLines().map((line) => `- ${line}`).join("\n")}

### Services and anything priced at ${SALES_THRESHOLD_LABEL} or more
SEO programs, website builds, business formation and contractor licensing, the Complete Business Build, the Master Class modules and bundle, and custom work are quoted by a sales rep. Never state a price for them — say "${SALES_REP_LABEL}" and point to the services section of the Pricing page (${SALES_HREF}).
Do not describe, name or price any product, plan, package or discount that is not listed in this price book. If you are not sure something is sold, say so and suggest the visitor ${SALES_REP_LABEL.toLowerCase()}.`;
}
