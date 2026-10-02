/**
 * Plan and price wording for pages, prompts and emails outside the pricing
 * page. Every number here is read from the price book (shared/plans.ts), so
 * copy can never drift from what checkout and entitlements enforce.
 */
import {
  PLANS, PLAN_KEYS, ADDONS, AGENCY_LOCATION_BANDS, AGENCY_SELF_SERVE_MAX_LOCATIONS,
  TRIAL_DAYS, SALES_THRESHOLD_CENTS, MODULE_NAMES, ANNUAL_MONTHS, planForModule, showsPrice,
  CALL_ASSISTANT_INCLUDED_MINUTES, CALL_ASSISTANT_INCLUDED_NUMBERS, CALL_MINUTE_OVERAGE_CENTS,
  type Plan, type PlanKey, type ModuleKey,
} from "./plans";

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

/** "Starter 1, Pro 3, Growth 10 and Agency 10". */
export const CRM_SEATS_LINE = joinNames(PLAN_KEYS.map((key) => `${PLANS[key].name} ${PLANS[key].limits.crmSeats}`));

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
    const intro = addon.key === "call_assistant" ? ` Launch price: ${callAssistantIntroLine()}.` : "";
    // A `preview` add-on is listed but refused at checkout (shared/plans.ts), so say so.
    const preview = addon.preview ? " Coming soon: listed, not for sale yet." : "";
    return `${addon.name} — ${formatUsd(addon.monthlyCents)}/month or ${formatUsd(addon.annualCents)}/year${setup} (${on}). ${addon.description}${intro}${preview}`;
  });
}

// ── AI Call Assistant ────────────────────────────────────────────────────────

/**
 * AI Call Assistant launch pricing (owner, 2026-10-02): "$99 a month for the
 * first 3 months", then the add-on's regular monthly price.
 *
 * The figures live in the price book (shared/plans.ts ADDONS.call_assistant
 * introMonthlyCents / introMonths) — the same fields the Stripe intro coupon is
 * built from (server/billing/intro.ts) — so the copy can never promise a price
 * checkout doesn't charge. Every surface renders through the helpers below:
 * the landing page, /call-assistant, the pricing page, the CRM Overview and
 * Gabe's knowledge.
 */
export const CALL_ASSISTANT_INTRO: { readonly monthlyCents: number; readonly months: number } = {
  monthlyCents: ADDONS.call_assistant.introMonthlyCents ?? ADDONS.call_assistant.monthlyCents,
  months: ADDONS.call_assistant.introMonths ?? 0,
};

/** "Pro, Growth and Agency" — the plans the add-on is sold on. */
export const CALL_ASSISTANT_PLANS = joinNames(ADDONS.call_assistant.availableOn.map((key) => PLANS[key].name));

/** Every Call Assistant price fact, formatted, for page copy ("$99", 3, "$249", …). */
export function callAssistantPricing() {
  const addon = ADDONS.call_assistant;
  return {
    name: addon.name,
    intro: formatUsd(CALL_ASSISTANT_INTRO.monthlyCents),
    introMonths: CALL_ASSISTANT_INTRO.months,
    regular: formatUsd(addon.monthlyCents),
    includedNumbers: CALL_ASSISTANT_INCLUDED_NUMBERS,
    includedMinutes: CALL_ASSISTANT_INCLUDED_MINUTES.toLocaleString("en-US"),
    overagePerMinute: formatUsd(CALL_MINUTE_OVERAGE_CENTS),
    extraNumber: formatUsd(ADDONS.call_number.monthlyCents),
    plans: CALL_ASSISTANT_PLANS,
    planKeys: addon.availableOn,
    /** Listed but not for sale yet (the numbers+billing lane drops the flag at launch). */
    comingSoon: addon.preview === true,
  };
}

/** "$99/month for your first 3 months, then $249/month". */
export function callAssistantIntroLine(): string {
  const p = callAssistantPricing();
  return `${p.intro}/month for your first ${p.introMonths} months, then ${p.regular}/month`;
}

/** "$99/mo for your first 3 months, then $249/mo" — the short form next to a price (pricing table, CRM Overview). */
export function callAssistantIntroShort(): string {
  const p = callAssistantPricing();
  return `${p.intro}/mo for your first ${p.introMonths} months, then ${p.regular}/mo`;
}

/** "1 local number and 500 call minutes a month, then $0.15 a minute; extra numbers $5/month each". */
export function callAssistantIncludesLine(): string {
  const p = callAssistantPricing();
  return `${p.includedNumbers} local number${p.includedNumbers === 1 ? "" : "s"} and ${p.includedMinutes} call minutes a month, then ${p.overagePerMinute} a minute; extra numbers ${p.extraNumber}/month each`;
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

/** Competitor Intel is on every plan with a monthly scan allowance. */
export const COMPETITOR_INTEL_PLANS = planNamesWhere((plan) => plan.limits.competitorScans > 0);
/** Click Guard + IP Tracker + VPN Shield come with every plan that protects at least one site. */
export const PROTECTED_SITE_PLANS = planNamesWhere((plan) => plan.limits.protectedSites > 0);
/** Plans with team text alerts. */
export const TEXTING_PLANS = planNamesWhere((plan) => plan.limits.teamTextSegments > 0);

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
There is no free plan. A new subscription starts with a ${TRIAL_LABEL}. Plans are billed monthly, or yearly at ${ANNUAL_MONTHS} times the monthly price. The ${PLANS.agency.name} location bands and every add-on are billed the same way: monthly, or yearly at ${ANNUAL_MONTHS} times their monthly price.
${plans}

Only the ${PLANS.agency.name} plan includes: ${joinNames(AGENCY_ONLY_MODULES)}.
The CRM (clients, estimates, invoices, payments, pipeline) is included in every plan. CRM seats per plan: ${CRM_SEATS_LINE}.
Competitor Intel is included with ${COMPETITOR_INTEL_PLANS}. Click Guard, IP Tracker and VPN Shield are included with ${PROTECTED_SITE_PLANS}. Texting is included with ${TEXTING_PLANS}.

### Add-ons (single features are sold only as add-ons to a plan)
${addonLines().map((line) => `- ${line}`).join("\n")}

### Services and anything priced at ${SALES_THRESHOLD_LABEL} or more
SEO programs, website builds, business formation and contractor licensing, the Complete Business Build, the Master Class modules and bundle, and custom work are quoted by a sales rep. Never state a price for them — say "${SALES_REP_LABEL}" and point to the services section of the Pricing page (${SALES_HREF}).
Do not describe, name or price any product, plan, package or discount that is not listed in this price book. If you are not sure something is sold, say so and suggest the visitor ${SALES_REP_LABEL.toLowerCase()}.`;
}
