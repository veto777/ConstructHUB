/**
 * Display helpers for the price book in shared/plans.ts — the pricing page,
 * Settings → Billing and the cart all read prices through here, so nothing on
 * the client hard-codes a plan name or a price. Pure (no React) so the server
 * test suite can check it against the price book and the server catalog.
 */
import {
  PLANS, PLAN_KEYS, ADDONS, AGENCY_LOCATION_BANDS, AGENCY_SELF_SERVE_MAX_LOCATIONS,
  MODULE_NAMES, agencyMonthlyCents, effectivePlanKey, showsPrice,
  type Addon, type AddonKey, type AddonModuleKey, type BillingInterval, type ModuleKey, type Plan, type PlanKey, type PlanLimits,
} from "@shared/plans";

// ── Money ───────────────────────────────────────────────────────────────────

/** "$29", "$1,649", "$24.17" — cents only when there are any. */
export function formatUsd(cents: number): string {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  });
}

export const intervalSuffix = (interval: BillingInterval) => (interval === "year" ? "/yr" : "/mo");
export const intervalWord = (interval: BillingInterval) => (interval === "year" ? "yearly" : "monthly");

export function planPriceCents(plan: Plan, interval: BillingInterval): number {
  return interval === "year" ? plan.annualCents : plan.monthlyCents;
}

/** What paying yearly saves over twelve monthly payments. */
export function annualSavingsCents(plan: Plan): number {
  return plan.monthlyCents * 12 - plan.annualCents;
}

/** Whole months free on annual billing, the same for every plan (10x monthly -> 2). */
export function annualMonthsFree(): number {
  return Math.min(...PLAN_KEYS.map((k) => Math.floor(annualSavingsCents(PLANS[k]) / PLANS[k].monthlyCents)));
}

export function addonPriceCents(addon: Addon, interval: BillingInterval): number {
  return interval === "year" ? addon.annualCents : addon.monthlyCents;
}

/** The plans an add-on can ride on, by name ("Pro, Growth, Agency"). */
export function addonPlanNames(addon: Addon): string {
  return PLAN_KEYS.filter((k) => addon.availableOn.includes(k)).map((k) => PLANS[k].name).join(", ");
}

export function addonsForPlan(plan: PlanKey): Addon[] {
  return (Object.keys(ADDONS) as AddonKey[]).map((k) => ADDONS[k]).filter((a) => a.availableOn.includes(plan));
}

// ── Agency locations ────────────────────────────────────────────────────────

export type AgencyQuoteLine = { label: string; count: number; centsPerLocation: number; subtotalCents: number };
export type AgencyQuote =
  | { sales: false; locations: number; monthlyCents: number; annualCents: number; lines: AgencyQuoteLine[] }
  | { sales: true; locations: number };

export const AGENCY_INCLUDED_LOCATIONS = PLANS.agency.limits.locations;

/** Annual is the same multiple of monthly for Agency as its base price (10x). */
const AGENCY_ANNUAL_MULTIPLE = PLANS.agency.annualCents / PLANS.agency.monthlyCents;

/** A location count typed by a person: a whole number, at least 1. */
export function normalizeLocations(input: unknown): number {
  const n = Math.floor(Number(input));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** "11–50" style labels for the graduated bands, first band included in the base. */
export function agencyBandRows(): { label: string; centsPerLocation: number | null }[] {
  let prev = 0;
  const rows: { label: string; centsPerLocation: number | null }[] = AGENCY_LOCATION_BANDS.map((b) => {
    const row = { label: `${(prev + 1).toLocaleString("en-US")}–${b.upTo.toLocaleString("en-US")}`, centsPerLocation: b.centsPerLocation };
    prev = b.upTo;
    return row;
  });
  rows.push({ label: `${(AGENCY_SELF_SERVE_MAX_LOCATIONS + 1).toLocaleString("en-US")}+`, centsPerLocation: null });
  return rows;
}

/** The bill for `locations` Agency locations, line by line; above self-serve it is a sales quote. */
export function agencyQuote(locationsInput: number): AgencyQuote {
  const locations = normalizeLocations(locationsInput);
  const monthlyCents = agencyMonthlyCents(locations);
  if (monthlyCents === null) return { sales: true, locations };
  const lines: AgencyQuoteLine[] = [{
    label: `Agency plan (${AGENCY_INCLUDED_LOCATIONS} locations included)`,
    count: Math.min(locations, AGENCY_INCLUDED_LOCATIONS), centsPerLocation: 0, subtotalCents: PLANS.agency.monthlyCents,
  }];
  let prev = 0;
  for (const band of AGENCY_LOCATION_BANDS) {
    const count = Math.max(0, Math.min(locations, band.upTo) - prev);
    if (band.centsPerLocation > 0 && count > 0) {
      lines.push({
        label: `Locations ${(prev + 1).toLocaleString("en-US")}–${Math.min(locations, band.upTo).toLocaleString("en-US")}`,
        count, centsPerLocation: band.centsPerLocation, subtotalCents: count * band.centsPerLocation,
      });
    }
    prev = band.upTo;
  }
  return { sales: false, locations, monthlyCents, annualCents: Math.round(monthlyCents * AGENCY_ANNUAL_MULTIPLE), lines };
}

// ── Ranking-grid credits ────────────────────────────────────────────────────

/**
 * Ranking-grid credits one grid costs: one per 25 grid points, rounded up
 * (3x3 and 5x5 = 1, 7x7 = 2, 9x9 = 4, 11x11 = 5, 13x13 = 7, 15x15 = 9). Mirrors
 * the server's gridCreditCost (server/growth-quotas.ts), which is what is
 * charged; server/client-plan-ui.test.ts keeps the two equal.
 */
export function gridCreditCost(gridSize: number): number {
  const size = Math.max(1, Math.floor(Number(gridSize) || 3));
  return Math.ceil((size * size) / 25);
}

/** "1 credit" / "4 credits". */
export const creditsLabel = (n: number) => `${n.toLocaleString("en-US")} credit${n === 1 ? "" : "s"}`;

// ── Monthly usage (GET /api/entitlements) ───────────────────────────────────

/** One monthly meter as the server reports it: limit -1 = unlimited (fair use), 0 = not in the plan. */
export type UsageMeter = { used: number; limit: number };

export type UsageKey = "searches" | "rankings" | "siteScans" | "competitorScans" | "texts";

/** GET /api/entitlements — the fields the client reads. */
export type EntitlementsInfo = {
  plan: PlanKey | null;
  storedPlan: string | null;
  accessPlan: PlanKey | null;
  planName: string | null;
  isPlatformAdmin: boolean;
  grantEndsAt: string | null;
  allowances: PlanLimits | null;
  modules: Record<ModuleKey, boolean>;
  /** Add-on modules that are on (every one for platform admins). */
  addonModules?: Partial<Record<AddonModuleKey, boolean>>;
  addons: Partial<Record<AddonKey, number>>;
  locations: UsageMeter;
  usage: Partial<Record<UsageKey, UsageMeter>>;
  resetsAt: string;
};

/** The monthly meters Settings → Billing shows, in display order. */
export const USAGE_METERS: readonly { key: UsageKey; label: string }[] = [
  { key: "searches", label: "Permit searches" },
  { key: "rankings", label: "Ranking-grid credits" },
  { key: "siteScans", label: "Site Scans" },
  { key: "competitorScans", label: "Competitor Intel scans" },
  { key: "texts", label: "Text segments" },
];

/** "12 of 100 used", "3 used · fair use" ("3 used · unlimited" for a platform admin), or null when the plan doesn't include it. */
export function usageLine(meter: UsageMeter | undefined, admin = false): string | null {
  if (!meter || meter.limit === 0) return null;
  const used = Math.max(0, meter.used).toLocaleString("en-US");
  return meter.limit < 0 ? `${used} used · ${admin ? "unlimited" : "fair use"}` : `${used} of ${meter.limit.toLocaleString("en-US")} used`;
}

/** Share of a finite meter used, 0–100 (null when unlimited or not included). */
export function usagePercent(meter: UsageMeter | undefined): number | null {
  if (!meter || meter.limit <= 0) return null;
  return Math.min(100, Math.round((Math.max(0, meter.used) / meter.limit) * 100));
}

// ── Plan comparison (generated from limits + modules) ───────────────────────

export type CompareCell = boolean | string;
export type CompareRow = { key: string; label: string; cells: Record<PlanKey, CompareCell> };
export type CompareSection = { title: string; rows: CompareRow[] };

const n = (v: number) => v.toLocaleString("en-US");
const perMonth = (v: number) => (v < 0 ? "Unlimited (fair use)" : `${n(v)} / mo`);
const countOrNone = (v: number, fmt: (v: number) => string): CompareCell => (v === 0 ? false : fmt(v));
const websites = (v: number) => (v < 0 ? "Unlimited" : `${n(v)} website${v === 1 ? "" : "s"}`);

function row(key: string, label: string, cell: (p: Plan) => CompareCell): CompareRow {
  const cells = {} as Record<PlanKey, CompareCell>;
  for (const k of PLAN_KEYS) cells[k] = cell(PLANS[k]);
  return { key, label, cells };
}

export function comparisonSections(): CompareSection[] {
  return [
    {
      title: "Google Business Profile",
      rows: [
        row("locations", "Google Business Profile locations", (p) =>
          p.key === "agency" ? `${n(p.limits.locations)} included, then per location` : n(p.limits.locations)),
        row("guard", "Profile Guard edit checks", (p) => `Every ${p.limits.guardCadenceMinutes} min`),
        row("autoPublish", "AI review replies publish automatically", (p) => p.limits.autoPublishAiReplies),
        row("templates", "Review reply templates", (p) => n(p.limits.reviewTemplates)),
        row("grid", "Ranking-grid credits", (p) =>
          p.limits.gridCreditsPerLocation > 0 ? `${n(p.limits.gridCreditsPerLocation)} per location / mo` : countOrNone(p.limits.gridCredits, perMonth)),
      ],
    },
    {
      title: "Websites & ads",
      rows: [
        row("protectedSites", "Click Guard + IP Tracker + VPN Shield", (p) => countOrNone(p.limits.protectedSites, websites)),
        row("siteScans", "Site Scans", (p) =>
          p.limits.siteScansPerLocation > 0 ? `${n(p.limits.siteScansPerLocation)} per location / mo` : countOrNone(p.limits.siteScans, perMonth)),
        row("competitorScans", "Competitor Intel scans", (p) => countOrNone(p.limits.competitorScans, perMonth)),
      ],
    },
    {
      title: "Permits & texting",
      rows: [
        row("permitSearches", "Permit searches", (p) => countOrNone(p.limits.permitSearches, perMonth)),
        row("teamText", "Team text alerts", (p) => countOrNone(p.limits.teamTextSegments, perMonth)),
        row("clientTexting", "Two-way client texting", (p) =>
          p.limits.clientTexting === "none" ? false
            : p.limits.clientTexting === "included" ? "1 number included"
            : "Your SignalWire number or the add-on"),
      ],
    },
    {
      title: "Agency tools",
      rows: (Object.keys(MODULE_NAMES) as ModuleKey[]).map((m) => row(`module-${m}`, MODULE_NAMES[m], (p) => p.modules[m])),
    },
  ];
}

/** Modules that only the Agency plan includes, by name. */
export function agencyOnlyModuleNames(): string[] {
  return (Object.keys(MODULE_NAMES) as ModuleKey[])
    .filter((m) => PLAN_KEYS.every((k) => (k === "agency") === PLANS[k].modules[m]))
    .map((m) => MODULE_NAMES[m]);
}

// ── The signed-in subscription ──────────────────────────────────────────────

/**
 * GET /api/stripe/subscription. The billing routes report the interval and the
 * Agency location count as `billingInterval` / `agencyLocations`; the shorter
 * `interval` / `locations` are read too. Fields past `stripeSubscriptionId`
 * may be absent (older server, no subscription).
 */
export type SubscriptionInfo = {
  plan: string;
  status: string;
  currentPeriodEnd?: string | null;
  stripeSubscriptionId?: string | null;
  billingInterval?: BillingInterval | null;
  interval?: BillingInterval | null;
  addons?: Partial<Record<AddonKey, number>> | null;
  agencyLocations?: number | null;
  locations?: number | null;
  cancelAtPeriodEnd?: boolean | null;
};

/**
 * Statuses that still hold a subscription (the server's own list): changing
 * plan must modify it, never start a second checkout.
 */
export const LIVE_STATUSES: readonly string[] = ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"];
/** Live statuses whose last payment failed: the card needs updating in Manage billing. */
export const PAYMENT_PROBLEM_STATUSES: readonly string[] = ["past_due", "unpaid", "incomplete"];

export type SubscriptionView = {
  /** The key as stored (may be a legacy key such as "platinum"). */
  storedPlan: string | null;
  /** The plan whose features apply (legacy keys mapped), null when none. */
  planKey: PlanKey | null;
  isLegacy: boolean;
  /** The name the customer bought: "Pro", or the legacy "Platinum". */
  displayName: string | null;
  /** Holds a plan (a Stripe subscription or an access grant). */
  live: boolean;
  viaStripe: boolean;
  /** Holds a Stripe subscription: plan changes modify it in place; a checkout would start a second one. */
  changesInPlace: boolean;
  /** Never had a Stripe subscription, so a checkout starts with the trial (one trial per account). */
  firstSubscription: boolean;
  interval: BillingInterval | null;
  /** Agency locations billed, when the server reports them. */
  locations: number | null;
};

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function describeSubscription(sub: SubscriptionInfo | null | undefined): SubscriptionView {
  const stored = sub?.plan && sub.plan !== "free" ? sub.plan : null;
  // Map the key whatever the status, so a past-due plan still shows by name.
  const planKey = stored ? effectivePlanKey({ plan: stored, status: "active" }) : null;
  const isLegacy = !!stored && !!planKey && stored !== planKey;
  const live = !!planKey && LIVE_STATUSES.includes(sub?.status ?? "");
  const viaStripe = !!sub?.stripeSubscriptionId;
  const interval = sub?.billingInterval ?? sub?.interval;
  const locations = Number(sub?.agencyLocations ?? sub?.locations);
  return {
    storedPlan: stored,
    planKey,
    isLegacy,
    displayName: stored ? (isLegacy || !planKey ? titleCase(stored) : PLANS[planKey].name) : null,
    live,
    viaStripe,
    changesInPlace: live && viaStripe,
    firstSubscription: !viaStripe,
    interval: interval === "month" || interval === "year" ? interval : null,
    locations: Number.isInteger(locations) && locations >= 1 ? locations : null,
  };
}

// ── Done-for-you services ───────────────────────────────────────────────────

/**
 * Services on /pricing. `catalogIds` are the server catalog entries
 * (server/catalog.ts DFY_CATALOG) each card stands for. A service without a
 * `priceCents` — every one priced at $1,000 or more — is "Talk to a sales rep":
 * no price and no checkout, and its catalog price never reaches the browser.
 * A service under the threshold would carry `priceCents` and a cart button.
 */
export type ServiceOffer = {
  id: string;
  title: string;
  blurb: string;
  bullets: string[];
  catalogIds: string[];
  priceCents?: number;
  cartId?: string;
};

export const DFY_SERVICES: ServiceOffer[] = [
  {
    id: "formation",
    title: "Business formation & contractor license",
    blurb: "We file the paperwork to set up your company and apply for your contractor license.",
    bullets: [
      "LLC or corporation formation with the Secretary of State",
      "Contractor license application processing",
      "Surety bond and insurance setup (GL, auto, workers' comp)",
      "EIN, state tax ID and business bank guidance",
    ],
    catalogIds: ["dfy_formation"],
  },
  {
    id: "website",
    title: "Google Business Profile & website",
    blurb: "A verified Google Business Profile and a contractor website built for your trades and service area.",
    bullets: [
      "Google Business Profile creation & verification",
      "Contractor website: design and content",
      "Service pages for each trade and location pages for your service areas",
      "Photo optimization & a GMB posting calendar",
    ],
    catalogIds: ["dfy_gmb_website"],
  },
  {
    id: "seo-ads",
    title: "SEO & ad campaigns",
    blurb: "Local SEO plus Google Ads and Local Services Ads set up for you.",
    bullets: [
      "Local SEO strategy & implementation",
      "Google Ads campaign setup & optimization",
      "Local Services Ads (LSA) enrollment",
      "Schema markup, Search Console & Analytics setup",
    ],
    catalogIds: ["dfy_seo_ads"],
  },
  {
    id: "seo-packages",
    title: "Monthly SEO packages",
    blurb: "Ongoing SEO for the keywords and service areas you choose, on a 6-month minimum.",
    bullets: [
      "Dedicated SEO strategist",
      "Technical SEO audit & fixes",
      "Keyword research, content and backlink building",
      "Monthly ranking reports",
    ],
    catalogIds: ["dfy_seo_first_page", "dfy_seo_growth", "dfy_seo_domination"],
  },
  {
    id: "business-build",
    title: "Complete Business Build",
    blurb: "Formation and licensing, Google Business Profile & website, and SEO & ads in one engagement.",
    bullets: [
      "Business formation & contractor license",
      "Google Business Profile & website",
      "SEO & ad campaigns",
      "Excludes licensing exams, prerequisites and required testing",
    ],
    catalogIds: ["dfy_bundle"],
  },
  {
    id: "custom",
    title: "Custom work",
    blurb: "Something that isn't listed here? Tell us what you need and a sales rep will scope it with you.",
    bullets: [],
    catalogIds: [],
  },
];

export const isSalesOnlyService = (s: ServiceOffer) => s.priceCents == null || !showsPrice(s.priceCents);

/** Cart ids of services sold only through a sales rep, whatever price a stored cart claims. */
export const SALES_ONLY_CART_IDS: ReadonlySet<string> = new Set(
  DFY_SERVICES.filter(isSalesOnlyService).flatMap((s) => s.catalogIds),
);

/** A cart line that must go through a sales rep instead of checkout. */
export function isSalesOnlyCartItem(item: { id: string; price: number }): boolean {
  return SALES_ONLY_CART_IDS.has(item.id) || !showsPrice(item.price);
}
