/**
 * Account pricing terms — what an account keeps that the price book no longer
 * sells (owner decisions, 2026-10-08):
 *
 *   - SEO grandfathering: an account that had the SEO tools before they became
 *     Agency-only keeps them (shared/plans.ts SEO_GRANDFATHERED_LIMITS).
 *   - Founding members: a customer who subscribed while the founding offer
 *     was open keeps the plan prices of that moment for life. The prices are
 *     copied into the account's row (`founding_prices`) when it is marked, so
 *     a later change to shared/plans.ts PLANS never moves them.
 *
 * The rows live in account_pricing_terms (server/billing/pricing-terms.ts);
 * the pure pieces — the snapshot shape and reading a price out of it — are
 * here so the server and the client agree.
 *
 * The founding offer has NO public number of places and NO deadline: nothing
 * here (and nothing that reads it) states a customer count or a limit.
 */
import {
  PLAN_KEYS, planPriceCents, isPlanKey,
  type BillingInterval, type PlanKey,
} from "./plans";

/** A plan's two prices as they were when the snapshot was taken. */
export type FoundingPlanPrice = { monthlyCents: number; annualCents: number };

/**
 * Every plan's prices plus everything an Agency location charge is computed
 * from (server/billing/prices.ts agencyLocationTiers: the bands, the included
 * locations each band bound is shifted by, and the annual multiplier), as
 * shared/plans.ts had them at the moment the account became a founding member.
 */
export type FoundingPrices = {
  plans: Record<Exclude<PlanKey, "team">, FoundingPlanPrice> & Partial<Record<"team", FoundingPlanPrice>>;
  agencyBands: { upTo: number; centsPerLocation: number }[];
  /** PLANS.agency.limits.locations: locations the Agency price includes before the bands apply. */
  agencyIncludedLocations: number;
  /** ANNUAL_MONTHS: yearly = this many months of the monthly price, plans and bands alike. */
  annualMonths: number;
  /** ISO subscription start time whose price book was captured. */
  capturedAt: string;
};

/** The account's stored terms, as the server reports them (null fields = not marked). */
export type AccountPricingTerms = {
  seoGrandfatheredAt: Date | string | null;
  seoGrandfatheredPlan: string | null;
  foundingMemberAt: Date | string | null;
  foundingPrices: FoundingPrices | null;
};

/**
 * Inclusive UTC boundary of the owner-approved five-plan book.
 * DEPLOY STEP: set this to the moment the five-plan ladder goes live in
 * production (the release deploy time), in the deploy commit. Subscriptions
 * started before it were sold on the four-plan book and lock those prices.
 * See docs/pricing/README.md "Deploying a new price book".
 */
export const FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT = "2026-10-09T20:34:00.000Z";

/**
 * Frozen four-plan book deployed 2026-09-30 (HANDOFF.md, that date's entry).
 * Applies to starts before the five-plan boundary, including older subscribers.
 * Keys retain their billing identity even when display names change.
 */
export const LEGACY_FOUNDING_PRICE_BOOK = Object.freeze({
  effectiveUntil: FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT,
  plans: Object.freeze({
    starter: Object.freeze({ monthlyCents: 2900, annualCents: 29000 }),
    pro: Object.freeze({ monthlyCents: 7900, annualCents: 79000 }),
    growth: Object.freeze({ monthlyCents: 19900, annualCents: 199000 }),
    agency: Object.freeze({ monthlyCents: 34900, annualCents: 349000 }),
  }),
  agencyBands: Object.freeze([
    Object.freeze({ upTo: 10, centsPerLocation: 0 }),
    Object.freeze({ upTo: 50, centsPerLocation: 1500 }),
    Object.freeze({ upTo: 250, centsPerLocation: 1000 }),
    Object.freeze({ upTo: 500, centsPerLocation: 700 }),
  ]),
  agencyIncludedLocations: 10,
  annualMonths: 10,
});

/** Keep dated books immutable: future repricing must add a version. */
export const FIVE_PLAN_FOUNDING_PRICE_BOOK = Object.freeze({
  effectiveFrom: FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT,
  plans: Object.freeze({
    starter: Object.freeze({ monthlyCents: 2900, annualCents: 29000 }),
    team: Object.freeze({ monthlyCents: 4900, annualCents: 49000 }),
    pro: Object.freeze({ monthlyCents: 9900, annualCents: 99000 }),
    growth: Object.freeze({ monthlyCents: 19900, annualCents: 199000 }),
    agency: Object.freeze({ monthlyCents: 44900, annualCents: 449000 }),
  }),
  // Retain the serialized shape; new Unlimited subscriptions have no bands.
  agencyBands: LEGACY_FOUNDING_PRICE_BOOK.agencyBands,
  agencyIncludedLocations: -1,
  annualMonths: 10,
});

/**
 * Copy the book in force at subscription start, never at delayed processing.
 * Add-ons and the separate AI Call Assistant subscription are outside the lock.
 */
export function priceSnapshot(startedAt = new Date()): FoundingPrices {
  const book = startedAt.getTime() < Date.parse(FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT)
    ? LEGACY_FOUNDING_PRICE_BOOK : FIVE_PLAN_FOUNDING_PRICE_BOOK;
  const plans = Object.fromEntries(Object.entries(book.plans).map(([key, price]) => [key, { ...price }])) as FoundingPrices["plans"];
  return {
    plans,
    agencyBands: book.agencyBands.map((b) => ({ ...b })),
    agencyIncludedLocations: book.agencyIncludedLocations,
    annualMonths: book.annualMonths,
    capturedAt: startedAt.toISOString(),
  };
}

/** A stored founding_prices value as FoundingPrices, or null when it is not one (never trusted blindly). */
export function parseFoundingPrices(raw: unknown): FoundingPrices | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const plans = r.plans;
  if (!plans || typeof plans !== "object" || Array.isArray(plans)) return null;
  const out = {} as Record<PlanKey, FoundingPlanPrice>;
  for (const key of PLAN_KEYS) {
    const p = (plans as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
    if (key === "team" && p === undefined) continue; // Absent from original four-plan snapshots.
    const monthlyCents = Number(p?.monthlyCents), annualCents = Number(p?.annualCents);
    if (!Number.isInteger(monthlyCents) || monthlyCents < 0 || !Number.isInteger(annualCents) || annualCents < 0) return null;
    out[key] = { monthlyCents, annualCents };
  }
  const bands = Array.isArray(r.agencyBands) ? r.agencyBands : [];
  const agencyBands: FoundingPrices["agencyBands"] = [];
  for (const b of bands as Record<string, unknown>[]) {
    const upTo = Number(b?.upTo), centsPerLocation = Number(b?.centsPerLocation);
    if (!Number.isInteger(upTo) || upTo <= 0 || !Number.isInteger(centsPerLocation) || centsPerLocation < 0) return null;
    agencyBands.push({ upTo, centsPerLocation });
  }
  const agencyIncludedLocations = Number(r.agencyIncludedLocations), annualMonths = Number(r.annualMonths);
  // -1 (Unlimited has no included-count) is a valid stored value: the bands it
  // fed are legacy and foundingPrice() reads the plans only.
  if (!Number.isInteger(agencyIncludedLocations) || agencyIncludedLocations < -1 || !Number.isInteger(annualMonths) || annualMonths <= 0) return null;
  return { plans: out, agencyBands, agencyIncludedLocations, annualMonths, capturedAt: typeof r.capturedAt === "string" ? r.capturedAt : "" };
}

/**
 * The price an account pays for a plan on an interval: its founding price when
 * it is a founding member whose snapshot carries that plan, otherwise the price
 * book's. Pure. `terms` null (no row) or an account that is not a founding
 * member reads the price book. The snapshot wins over PLANS whatever PLANS says
 * now — that is the whole promise.
 */
export function foundingPrice(terms: AccountPricingTerms | null | undefined, plan: PlanKey, interval: BillingInterval): number {
  if (!isPlanKey(plan)) throw new Error(`Unknown plan: ${String(plan)}`);
  const snapshot = terms?.foundingMemberAt ? parseFoundingPrices(terms.foundingPrices) : null;
  const price = snapshot?.plans[plan];
  if (price) return interval === "year" ? price.annualCents : price.monthlyCents;
  return planPriceCents(plan, interval);
}

/** Is this account a founding member (marked, whatever its plan is now)? */
export const isFoundingMember = (terms: AccountPricingTerms | null | undefined): boolean => !!terms?.foundingMemberAt;

/**
 * The one public line about the offer, shown ONLY while it is open (GET
 * /api/pricing/founding-offer). No count, no deadline, no "limited to".
 */
export const FOUNDING_OFFER_LINE = "Founding member pricing — sign up while the offer is open and your plan's price is locked in for life.";
/** What a founding member reads on their own plan / billing page. */
export const FOUNDING_MEMBER_LINE = "Founding member — your price is locked.";
