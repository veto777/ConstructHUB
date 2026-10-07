/**
 * ConstructHUB CRM — the price book for the CRM as a SEPARATE product.
 *
 * Owner decision 2026-10-07: the CRM and the ConstructHUB platform are two apps,
 * sold separately. Someone can buy either one alone, or both. Nothing is bundled:
 * a platform plan grants NO CRM seats (shared/plans.ts, every tier `crmSeats: 0`)
 * and a CRM plan grants NO platform tools.
 *
 * Pricing rule (owner): half of Housecall Pro, on both billing modes. Verified
 * against housecallpro.com/pricing on 2026-10-07:
 *     Basic      $79/mo   $59/mo billed annually ($708/yr)   1 user
 *     Essentials $189/mo  $149/mo billed annually ($1,788/yr) 5 users
 *     Max        $329/mo  $299/mo billed annually ($3,588/yr) 8 users
 *     Extra user $35/mo
 * Half of each, rounded to a clean price point, is the table below.
 *
 * NOTE: the platform's "annual = 10x monthly" rule (ANNUAL_MONTHS in plans.ts)
 * does NOT apply here. Housecall Pro discounts annual ~25%, so matching it at
 * half required an explicit annual price per tier (~9x monthly). Read annual
 * prices from `annualCents`; never derive them with ANNUAL_MONTHS.
 *
 * Money is in cents.
 */

export type CrmPlanKey = "crm_basic" | "crm_essentials" | "crm_max";
export const CRM_PLAN_KEYS: readonly CrmPlanKey[] = ["crm_basic", "crm_essentials", "crm_max"];

export type CrmPlanLimits = {
  /** Team seats included. -1 means unlimited (fair use). */
  seats: number;
  /** Clients/contacts the workspace may hold. -1 = unlimited. */
  clients: number;
  /** Estimates + invoices created per calendar month. -1 = unlimited. */
  documentsPerMonth: number;
  /** Team alert texts (shared number), segments per month. */
  teamTextSegments: number;
  /** "none" | bring-your-own SignalWire or the texting add-on | one number included. */
  clientTexting: "none" | "byo_or_addon" | "included";
  /** Online payments (card/ACH via Stripe) on estimates and invoices. */
  onlinePayments: boolean;
  /** The client-facing portal (approve estimates, pay invoices, message). */
  clientPortal: boolean;
  /** Scheduling + dispatch calendar. */
  scheduling: boolean;
  /** Price book with saved line items and cost codes. */
  priceBook: boolean;
  /** Change orders, budget lines and job costing. */
  jobCosting: boolean;
  /** CRM public API (/api/v1) units per calendar month; 0 = not included. */
  apiUnitsPerMonth: number;
};

export type CrmPlan = {
  key: CrmPlanKey;
  name: string;
  monthlyCents: number;
  /** The FULL year price. Not derived from monthlyCents — see the file header. */
  annualCents: number;
  tagline: string;
  /** What the buyer gets, in display order. Must match `limits`. */
  features: string[];
  /**
   * What this plan does NOT include — shown at checkout, verbatim, before the
   * buyer pays (owner order 2026-10-07: "tell the user/buyer what they are
   * buying and what they are not getting"). Platform-only tools belong here,
   * because no CRM plan grants them.
   */
  notIncluded: string[];
  limits: CrmPlanLimits;
};

/** Every CRM plan excludes the whole platform app; tier-specific gaps are added per plan. */
const PLATFORM_NOT_INCLUDED: readonly string[] = [
  "Google Business Profile tools — Profile Guard, review alerts, AI replies, ranking grid",
  "Click Guard, IP Tracker and VPN Shield (click-fraud protection)",
  "Permit and property-record search",
  "Site Scans, Competitor Intel and ConstructHUB SEO",
  "The AI Call Assistant",
];

export const CRM_PLANS: Record<CrmPlanKey, CrmPlan> = {
  crm_basic: {
    key: "crm_basic", name: "CRM Basic", monthlyCents: 3900, annualCents: 34800,
    tagline: "One person, running jobs end to end.",
    features: [
      "1 seat",
      "Unlimited clients and jobs",
      "Estimates, invoices and payments",
      "Online card and ACH payments",
      "Client portal — approve estimates, pay invoices",
      "Schedule and dispatch calendar",
      "Price book",
      "Email support",
    ],
    notIncluded: [
      "Extra seats (add them for $17/mo each, or move up to Essentials)",
      "Team alert texts and client texting",
      "Change orders and job costing",
      ...PLATFORM_NOT_INCLUDED,
    ],
    limits: {
      seats: 1, clients: -1, documentsPerMonth: -1, teamTextSegments: 0, clientTexting: "none",
      onlinePayments: true, clientPortal: true, scheduling: true, priceBook: true, jobCosting: false,
      apiUnitsPerMonth: 0,
    },
  },
  crm_essentials: {
    key: "crm_essentials", name: "CRM Essentials", monthlyCents: 9400, annualCents: 88800,
    tagline: "A crew — scheduling, texting and job costing.",
    features: [
      "Everything in Basic",
      "5 seats",
      "Team alert texts — 500 segments / month",
      "Client texting with your own SignalWire number (or the texting add-on)",
      "Change orders, budget lines and job costing",
      "CRM API — 10,000 units / month",
      "Priority email support",
    ],
    notIncluded: [
      "A client-texting number on our carrier (bring your own, or add one)",
      ...PLATFORM_NOT_INCLUDED,
    ],
    limits: {
      seats: 5, clients: -1, documentsPerMonth: -1, teamTextSegments: 500, clientTexting: "byo_or_addon",
      onlinePayments: true, clientPortal: true, scheduling: true, priceBook: true, jobCosting: true,
      apiUnitsPerMonth: 10_000,
    },
  },
  crm_max: {
    key: "crm_max", name: "CRM Max", monthlyCents: 16400, annualCents: 178800,
    tagline: "A full office — more seats, a number included.",
    features: [
      "Everything in Essentials",
      "8 seats",
      "Team alert texts — 1,500 segments / month",
      "1 client-texting number included",
      "CRM API — 50,000 units / month",
      "Priority support + onboarding call",
    ],
    notIncluded: [...PLATFORM_NOT_INCLUDED],
    limits: {
      seats: 8, clients: -1, documentsPerMonth: -1, teamTextSegments: 1500, clientTexting: "included",
      onlinePayments: true, clientPortal: true, scheduling: true, priceBook: true, jobCosting: true,
      apiUnitsPerMonth: 50_000,
    },
  },
};

/** One more CRM seat, beyond the plan's included count. Half of Housecall Pro's $35. */
export const CRM_EXTRA_SEAT_MONTHLY_CENTS = 1700;
export const CRM_EXTRA_SEAT_ANNUAL_CENTS = 17000;

/** Free trial on the CRM, in days. Housecall Pro gives 14; we match it. */
export const CRM_TRIAL_DAYS = 14;

export const isCrmPlanKey = (value: unknown): value is CrmPlanKey =>
  typeof value === "string" && (CRM_PLAN_KEYS as readonly string[]).includes(value);

export const crmPlanPriceCents = (plan: CrmPlanKey, interval: "month" | "year") =>
  interval === "year" ? CRM_PLANS[plan].annualCents : CRM_PLANS[plan].monthlyCents;

/** The cheapest CRM plan whose limits satisfy `want` — for "upgrade to get X" hints. */
export function cheapestCrmPlanWhere(want: (limits: CrmPlanLimits) => boolean): CrmPlanKey | null {
  return CRM_PLAN_KEYS.find((k) => want(CRM_PLANS[k].limits)) ?? null;
}
