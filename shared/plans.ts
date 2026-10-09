/**
 * The price book and what each plan gets — the single source of truth for the
 * server (checkout, entitlements, quotas) and the client (pricing page, upgrade
 * prompts). Owner decisions 2026-10-09 (the cost-based rebuild — docs/pricing/README.md):
 *   - Five plans: Solo $29 (1 location) / Team $49 (10) / Pro $99 (25) /
 *     Agency $199 (100) / Unlimited $449 (no caps). Annual = 10x monthly.
 *     Plan KEYS keep their old names so stored subscriptions still resolve:
 *     starter = Solo, team = Team (new), pro = Pro, growth = Agency,
 *     agency = Unlimited. Never rename a key; rename `name`.
 *   - Rule: anything that costs us nothing per unit is unlimited on the top
 *     plan; anything metered (grids, competitor scans, texts, SEO data,
 *     numbers) is an allowance that steps up with the plan. No per-location
 *     bands and no extra-location add-on: outgrow a plan, move up.
 *   - Every premium perk (auto-publish, Ads & LSA manager, Cloudflare + Search
 *     Console, Domains + Gmail, API, social publishing, property records, CSV
 *     export) starts at Pro. Client workspaces, scheduled reports, permit
 *     alerts and grid watches start at Agency. White label, the Master Class,
 *     the full SEO suite and unlimited everything are Unlimited only.
 *   - No free plan; a 1-day trial.
 *   - (2026-09-30) Earlier ladder: Starter $29 / Pro $79 / Growth $199 /
 *     Agency $349 + location bands — superseded; bands stay only to read old rows.
 *   - Single features are bought as add-ons, not standalone tools.
 *   - 2026-10-07: the CRM is a SEPARATE PRODUCT (shared/crm-plans.ts). No
 *     platform plan grants CRM seats, and no CRM plan grants platform tools.
 *     Every plan states what it does NOT include, shown at checkout.
 *   - 2026-10-08: the AI Call Assistant is a SEPARATE SERVICE too, on its own
 *     subscription (CALL_ASSISTANT_TIERS below, server/voice/subscription.ts):
 *     no platform plan includes it, and it is bought with or without one.
 *   - Anything priced at $1,000 or more is "Talk to a sales rep", never a price.
 * Money is in cents.
 */

export type PlanKey = "starter" | "team" | "pro" | "growth" | "agency";
/** Cheapest first — the upgrade order. Display names: Solo, Team, Pro, Agency, Unlimited (see PLANS). */
export const PLAN_KEYS: readonly PlanKey[] = ["starter", "team", "pro", "growth", "agency"];
export type BillingInterval = "month" | "year";

/** -1 means unlimited (fair use). */
export type PlanLimits = {
  /** Google Business Profile locations included (-1 on Unlimited). */
  locations: number;
  /** Client workspaces in the agency workspace (0 = the module is off for this plan). */
  clientWorkspaces: number;
  /** Client-texting numbers on our carrier included with the plan (more are the texting_number add-on). */
  textingNumbersIncluded: number;
  /** How long scan, grid and ranking history is kept, in days (-1 = for ever). Enforcement: docs/pricing/README.md "coming". */
  historyDays: number;
  /** Gabe (the Hub assistant) questions per calendar month (-1 = unlimited). */
  gabeQuestions: number;
  /** Profile Guard check cadence in minutes. */
  guardCadenceMinutes: number;
  /** Ranking-grid credits per month (Agency: per location). */
  gridCredits: number;
  gridCreditsPerLocation: number;
  competitorScans: number;
  /** Click Guard + IP Tracker + VPN Shield sites. */
  protectedSites: number;
  /** Site Scans per month (Agency: per location). */
  siteScans: number;
  siteScansPerLocation: number;
  permitSearches: number;
  /**
   * Agency workspace team seats (owner / admin / manager / viewer).
   * NOT CRM seats: the CRM is a separate product and its seats come from
   * the account's CRM plan (shared/crm-plans.ts, `CrmPlanLimits.seats`).
   */
  agencySeats: number;
  /** Team alert texts (shared number), segments per month. */
  teamTextSegments: number;
  /** "none" | bring-your-own SignalWire or the texting add-on | one number included. */
  clientTexting: "none" | "byo_or_addon" | "included";
  /** AI review replies may publish without a human approving each one. */
  autoPublishAiReplies: boolean;
  reviewTemplates: number;
  /**
   * Public API (/api/v1, `chub_` keys) units per calendar month; 0 = the API
   * is not included. A read costs 1 unit (+1 per 100 rows), a write 5. The
   * API never reaches TruthCoder AI: it stores what the caller sends.
   */
  apiUnitsPerMonth: number;
  /** Public API requests per minute, per key. */
  apiRatePerMinute: number;
  /**
   * ConstructHUB SEO (site explorer, rank tracker, keyword research,
   * backlinks): tracked keywords across the account's sites (a standing
   * count), and the monthly SEO data allowance in cents AT THE CUSTOMER'S
   * PRICE (shared/seo-credits.ts: every lookup costs SEO_MARKUP x wholesale;
   * more is bought as prepaid credit). Numbers in SEO_PLAN_LIMITS below.
   * seoKeywords 0 means the plan has no SEO tools at all (server/seo/plan.ts).
   */
  seoKeywords: number;
  seoCreditCents: number;
};

/**
 * ConstructHUB SEO allowances per plan — the ONE place these numbers live.
 * Owner, 2026-10-08: the SEO tools are included with the Agency plan only.
 * Starter, Pro and Growth sold from now on have none (0 / 0), so the SEO gate
 * (server/seo/plan.ts: seoKeywords !== 0) is off for them. seoCreditCents is
 * the monthly SEO data allowance at the customer's price (owner, 2026-10-07:
 * $40 on Agency); anything beyond is prepaid credit (shared/seo-credits.ts).
 * Accounts that had the SEO tools before the change keep them:
 * SEO_GRANDFATHERED_LIMITS below, applied by server/entitlements.ts.
 */
export const SEO_PLAN_LIMITS: Record<PlanKey, Pick<PlanLimits, "seoKeywords" | "seoCreditCents">> = {
  starter: { seoKeywords: 0, seoCreditCents: 0 },
  team: { seoKeywords: 0, seoCreditCents: 0 },
  pro: { seoKeywords: 0, seoCreditCents: 0 },
  // Agency ($199): a taste — 250 tracked keywords and $10 of data. The suite itself is the SEO add-on below.
  growth: { seoKeywords: 250, seoCreditCents: 1000 },
  // Unlimited ($449): the full suite, the same numbers as the seo_pro add-on.
  agency: { seoKeywords: 5000, seoCreditCents: 6000 },
};
/**
 * What a grandfathered account keeps on each plan — the SEO allowances Starter,
 * Pro and Growth carried before 2026-10-08 (owner, 2026-10-07: $10 / $20 / $40
 * of SEO data a month; 50 / 200 / 1,000 tracked keywords). An account marked
 * seo_grandfathered_at (server/billing/pricing-terms.ts) gets these on
 * whatever plan it is on now, while it has one; the overlay only ever raises
 * an allowance (Agency's own numbers already match). Not a public price:
 * never shown on the pricing page.
 */
export const SEO_GRANDFATHERED_LIMITS: Record<PlanKey, Pick<PlanLimits, "seoKeywords" | "seoCreditCents">> = {
  starter: { seoKeywords: 50, seoCreditCents: 1000 },
  team: { seoKeywords: 50, seoCreditCents: 1000 },
  pro: { seoKeywords: 200, seoCreditCents: 2000 },
  growth: { seoKeywords: 1000, seoCreditCents: 4000 },
  agency: { seoKeywords: 1000, seoCreditCents: 4000 },
};
/** The plan bullet for the SEO data allowance: "SEO data: $40 / month included" (Agency: the plan that includes the SEO tools). */
export const seoDataBullet = (plan: PlanKey) => `SEO data: $${SEO_PLAN_LIMITS[plan].seoCreditCents / 100} / month included`;
/** The "not included" line on every plan without the SEO tools: names the plan that has them, no price. */
export const SEO_NOT_INCLUDED_LINE = "SEO tools — rank tracking, keyword research, backlinks (the SEO add-on from $29/mo, or Unlimited)";

/** The numeric limits (the ones an add-on can raise). */
export type CountLimitKey = { [K in keyof PlanLimits]: PlanLimits[K] extends number ? K : never }[keyof PlanLimits];

/** A count or monthly limit with no ceiling (PlanLimits: "-1 means unlimited"). Platform admins run on it. */
export const UNLIMITED = -1;
export const isUnlimited = (limit: number | null | undefined) => limit === UNLIMITED;
/** Does `used + adding` fit under a count limit? An unlimited limit always fits. */
export const fitsLimit = (limit: number, used: number, adding = 1) => limit === UNLIMITED || used + adding <= limit;

export type PlanModules = {
  agencyWorkspace: boolean;
  adsManager: boolean;
  cloudflareSearchConsole: boolean;
  domainsMailAlerts: boolean;
  /** AI posts and photo captions published on a schedule. */
  autoPosts: boolean;
  /** Review reminders to customers by text and email (server/review-reminders.ts). */
  reviewReminders: boolean;
  /** Property records lookup (the database directory). */
  propertyRecords: boolean;
  /** YouTube + social publishing (server/social, server/youtube). */
  socialPublishing: boolean;
  /** CSV export of every report. COMING: no export exists yet (docs/pricing/README.md). */
  csvExport: boolean;
  /** Scheduled client email reports — LIVE: server/seo/site-report-send.ts, sent by server/seo/jobs.ts. */
  scheduledReports: boolean;
  /** Permit alerts for new filings in a territory. COMING. */
  permitAlerts: boolean;
  /** Weekly / monthly scheduled grid watches (server/seo/grid-monitor.ts). */
  gridWatches: boolean;
  /** White-label reports under the agency's own brand. */
  whiteLabel: boolean;
  /** The Master Class course included. */
  masterClass: boolean;
};
/**
 * Modules the page lists as "Coming" — promised on the plan, not yet built.
 * Drop a key here the day it ships. 2026-10-09: scheduledReports left the
 * list — the scheduled client email report is built and shipping
 * (server/seo/site-report-send.ts, run by server/seo/jobs.ts; schedules are
 * saved from the SEO Reports page, server/seo/routes.ts).
 */
export const COMING_MODULES: readonly ModuleKey[] = ["csvExport", "permitAlerts"];
export type ModuleKey = keyof PlanModules;

/**
 * The module a plan's feature bullet advertises — the ONE hook that carries
 * COMING_MODULES onto every surface that renders plan bullets (the plan cards
 * and the checkout purchase review on /pricing). A bullet keyed here wears a
 * "Coming soon" badge while its module sits in COMING_MODULES; the day the
 * module ships and leaves COMING_MODULES, every surface updates from this one
 * map. Keyed by the exact bullet string: a bullet is plain text in
 * Plan.features, and this map is the typed link between the words and the
 * module. server/plans-coming-features.test.ts keeps it in sync.
 */
export const FEATURE_BULLET_MODULE: Partial<Record<string, ModuleKey>> = {
  "CSV export of every report": "csvExport",
  "Scheduled client email reports": "scheduledReports",
  "Permit alerts for new filings in your territory": "permitAlerts",
};

/** Does this plan bullet advertise a module that is still in COMING_MODULES? Drives the "Coming soon" badge on the plan cards and the checkout purchase review — one mechanism, derived from COMING_MODULES. */
export const isComingFeature = (line: string): boolean => {
  const module = FEATURE_BULLET_MODULE[line];
  return module != null && COMING_MODULES.includes(module);
};

export type Plan = {
  key: PlanKey;
  name: string;
  monthlyCents: number;
  annualCents: number;
  tagline: string;
  /** Marketing bullets, in display order. Must match `limits`/`modules`. */
  features: string[];
  /**
   * What this plan does NOT include, shown at checkout verbatim before the
   * buyer pays (owner order 2026-10-07). The CRM leads every list and the AI
   * Call Assistant follows it: both are separate products that no platform
   * plan grants.
   */
  notIncluded: string[];
  limits: PlanLimits;
  modules: PlanModules;
};

export const NO_PLAN_MODULES: PlanModules = {
  agencyWorkspace: false, adsManager: false, cloudflareSearchConsole: false, domainsMailAlerts: false,
  autoPosts: false, reviewReminders: false, propertyRecords: false, socialPublishing: false, csvExport: false,
  scheduledReports: false, permitAlerts: false, gridWatches: false, whiteLabel: false, masterClass: false,
};
/** Everything that starts at Pro. */
const NO_MODULES = NO_PLAN_MODULES;
const PRO_MODULES: PlanModules = {
  ...NO_MODULES, adsManager: true, cloudflareSearchConsole: true, domainsMailAlerts: true,
  autoPosts: true, reviewReminders: true, propertyRecords: true, socialPublishing: true, csvExport: true,
};
/** Pro's modules plus what starts at Agency. */
const AGENCY_MODULES: PlanModules = { ...PRO_MODULES, agencyWorkspace: true, scheduledReports: true, permitAlerts: true, gridWatches: true };
/** Everything. */
const ALL_MODULES: PlanModules = { ...AGENCY_MODULES, whiteLabel: true, masterClass: true };
const CRM_NOT_INCLUDED_LINE = "The ConstructHUB CRM — estimates, invoices, scheduling and the client portal (a separate product, from $39/mo)";

// ── AI Call Assistant: a SEPARATE SERVICE ───────────────────────────────────
// Owner, 2026-10-08 (late evening): the AI Call Assistant is sold on its own
// subscription (server/voice/subscription.ts), the way the CRM is
// (shared/crm-plans.ts): no platform plan includes it, and it can be bought
// with no platform plan at all. Four tiers, one per account, named by what
// they include:
//   500 minutes $249/mo (1 number) · 1,000 minutes $349/mo (1 number) ·
//   2,000 minutes $449/mo (2 numbers) · 5,000 minutes $999/mo (5 numbers).
// Every tier: $0.50 a minute above the included minutes. Yearly billing is
// CALL_ASSISTANT_ANNUAL_MONTHS (11) times the monthly price — one month free,
// a smaller discount than the plans' two months (ANNUAL_MONTHS). No intro
// price. More than 5,000 minutes a month is a sales conversation (the $1,000+
// rule, SALES_THRESHOLD_CENTS), never a listed price. The first
// CALL_ASSISTANT_FREE_SPAM_CALLS spam calls a month never count, as before.
// The tier keys (lite / solo / crew / fleet) and the add-on keys are kept so
// every voice code path keeps working; the names and numbers are the new ones.
// Nobody held a tier when the prices changed (production: 0 rows), so there is
// nothing to grandfather. NOT part of the founding member price lock
// (shared/pricing-terms.ts): that covers the plans and the Agency bands only.

export type CallAssistantTierKey = "lite" | "solo" | "crew" | "fleet";
export type CallAssistantTier = {
  tier: CallAssistantTierKey;
  /** The add-on key that sells this tier (the second tier keeps the original `call_assistant` key). */
  addon: AddonKey;
  /** "500 minutes" — the tier is named by the minutes it includes. */
  name: string;
  monthlyCents: number;
  /** CALL_ASSISTANT_ANNUAL_MONTHS × monthlyCents (not the plans' ANNUAL_MONTHS). */
  annualCents: number;
  /** Call minutes included each calendar month (UTC). */
  includedMinutes: number;
  /** Local numbers included (more are the call_number add-on). */
  includedNumbers: number;
  /**
   * What a minute above `includedMinutes` costs, in cents — the same on every
   * tier (CALL_ASSISTANT_OVERAGE_CENTS_PER_MINUTE). A call is billed at the
   * rate in force when it is recorded (server/voice/billing-usage.ts).
   */
  overageCentsPerMinute: number;
};
/** Yearly Call Assistant billing: this many months of the monthly price (one month free). */
export const CALL_ASSISTANT_ANNUAL_MONTHS = 11;
/** A minute above a tier's included minutes, in cents, on every tier (owner, 2026-10-08: 50 cents). */
export const CALL_ASSISTANT_OVERAGE_CENTS_PER_MINUTE = 50;
const callAssistantTierDef = (tier: CallAssistantTierKey, addon: AddonKey, monthlyCents: number, includedMinutes: number, includedNumbers: number): CallAssistantTier => ({
  tier, addon, name: `${includedMinutes.toLocaleString("en-US")} minutes`, monthlyCents,
  annualCents: monthlyCents * CALL_ASSISTANT_ANNUAL_MONTHS, includedMinutes, includedNumbers,
  overageCentsPerMinute: CALL_ASSISTANT_OVERAGE_CENTS_PER_MINUTE,
});
/**
 * Cheapest first; the order is the upgrade order. Yearly: $2,739 / $3,839 /
 * $4,939 / $10,989 (11 × monthly). The top tier is the most that is listed.
 */
export const CALL_ASSISTANT_TIERS: readonly CallAssistantTier[] = [
  callAssistantTierDef("lite", "call_assistant_lite", 24900, 500, 1),
  callAssistantTierDef("solo", "call_assistant", 34900, 1000, 1),
  callAssistantTierDef("crew", "call_assistant_crew", 44900, 2000, 2),
  callAssistantTierDef("fleet", "call_assistant_fleet", 99900, 5000, 5),
];
export const CALL_ASSISTANT_TIER_ADDONS: readonly AddonKey[] = CALL_ASSISTANT_TIERS.map((t) => t.addon);
/** The product's name; each tier's add-on is "<this> — <tier name>". */
export const CALL_ASSISTANT_NAME = "AI Call Assistant";
/** The cheapest tier's monthly price: the "from" price every "separate service" line quotes. */
export const CALL_ASSISTANT_FROM_CENTS = Math.min(...CALL_ASSISTANT_TIERS.map((t) => t.monthlyCents));
/** Where the Call Assistant is bought: its own section of the pricing page. */
export const CALL_ASSISTANT_PRICING_HREF = "/pricing#call-assistant";
/** `code` on the 402 a Call Assistant route answers without the service (server/entitlements.ts sendModuleRequired). */
export const CALL_ASSISTANT_REQUIRED_CODE = "call_assistant_required";
/**
 * The "not included" line every platform plan AND every CRM plan carries
 * (shown at checkout): the Call Assistant is a separate service, with its
 * real starting price — the CRM line's pattern.
 */
export const CALL_ASSISTANT_NOT_INCLUDED_LINE = `The ${CALL_ASSISTANT_NAME} — answers your phone 24/7, screens spam and files the lead (a separate service, from $${CALL_ASSISTANT_FROM_CENTS / 100}/mo)`;

// ─────────────────────────────────────────────────────────────────────────────
// FOUNDING MEMBERS KEEP THEIR PRICE (owner, 2026-10-08). An account marked
// founding_member_at (server/billing/pricing-terms.ts) stores its own copy of
// these prices — founding_prices — at the moment it joined, and keeps it for
// life. Changing monthlyCents / annualCents / AGENCY_LOCATION_BANDS below must
// NEVER move a founding member: read their price with shared/pricing-terms.ts
// foundingPrice(terms, plan, interval), never from PLANS directly, before any
// repricing. The offer has no public number of places and no deadline.
// ─────────────────────────────────────────────────────────────────────────────
export const PLANS: Record<PlanKey, Plan> = {
  starter: {
    key: "starter", name: "Solo", monthlyCents: 2900, annualCents: 29000,
    tagline: "One Google profile, managed and protected.",
    features: [
      "1 Google Business Profile location",
      "Profile Guard edit alerts (checks every hour)",
      "Review alerts and AI reply drafts you approve",
      "5 review reply templates",
      "10 permit searches / month",
      "Click Guard + IP Tracker + VPN Shield — 1 website",
      "2 Site Scans / month",
      "3 ranking-grid credits / month",
      "1 Competitor Intel scan / month",
      "Team text alerts — 200 segments / month",
      "Gabe, the Hub assistant — 100 questions / month",
      "Email support",
    ],
    notIncluded: [
      CRM_NOT_INCLUDED_LINE,
      CALL_ASSISTANT_NOT_INCLUDED_LINE,
      SEO_NOT_INCLUDED_LINE,
      "Automatic AI review replies, AI posts on a schedule (Pro and up)",
      "Review reminders to customers (Team and up)",
      "Google Ads & LSA manager, Cloudflare + Search Console, Domains + Gmail alerts, the API (Pro and up)",
      "A client-texting number on our carrier (add one)",
    ],
    limits: {
      locations: 1, clientWorkspaces: 0, guardCadenceMinutes: 60, gridCredits: 3, gridCreditsPerLocation: 0, competitorScans: 1,
      protectedSites: 1, siteScans: 2, siteScansPerLocation: 0, permitSearches: 10, agencySeats: 1,
      teamTextSegments: 200, clientTexting: "byo_or_addon", textingNumbersIncluded: 0, autoPublishAiReplies: false, reviewTemplates: 5,
      apiUnitsPerMonth: 0, apiRatePerMinute: 60, historyDays: 90, gabeQuestions: 100,
      ...SEO_PLAN_LIMITS.starter,
    },
    modules: NO_MODULES,
  },
  team: {
    key: "team", name: "Team", monthlyCents: 4900, annualCents: 49000,
    tagline: "Up to 10 locations and a small crew.",
    features: [
      "Everything in Solo",
      "10 Google Business Profile locations",
      "3 team seats",
      "Profile Guard checks every 30 min",
      "20 review reply templates",
      "Review reminders to your customers by text and email",
      "50 permit searches / month",
      "Click Guard + IP Tracker + VPN Shield — 3 websites",
      "5 Site Scans / month",
      "10 ranking-grid credits / month",
      "5 Competitor Intel scans / month",
      "Team text alerts — 500 segments / month",
      "Gabe — 300 questions / month",
    ],
    notIncluded: [
      CRM_NOT_INCLUDED_LINE,
      CALL_ASSISTANT_NOT_INCLUDED_LINE,
      SEO_NOT_INCLUDED_LINE,
      "Automatic AI review replies, AI posts on a schedule (Pro and up)",
      "Google Ads & LSA manager, Cloudflare + Search Console, Domains + Gmail alerts, the API, CSV export (Pro and up)",
      "A client-texting number on our carrier (add one)",
    ],
    limits: {
      locations: 10, clientWorkspaces: 0, guardCadenceMinutes: 30, gridCredits: 10, gridCreditsPerLocation: 0, competitorScans: 5,
      protectedSites: 3, siteScans: 5, siteScansPerLocation: 0, permitSearches: 50, agencySeats: 3,
      teamTextSegments: 500, clientTexting: "byo_or_addon", textingNumbersIncluded: 0, autoPublishAiReplies: false, reviewTemplates: 20,
      apiUnitsPerMonth: 0, apiRatePerMinute: 60, historyDays: 90, gabeQuestions: 300,
      ...SEO_PLAN_LIMITS.team,
    },
    modules: { ...NO_MODULES, reviewReminders: true },
  },
  pro: {
    key: "pro", name: "Pro", monthlyCents: 9900, annualCents: 99000,
    tagline: "Every premium tool, for up to 25 locations.",
    features: [
      "Everything in Team",
      "25 Google Business Profile locations",
      "5 team seats",
      "Profile Guard checks every 15 min",
      "AI review replies publish automatically",
      "AI posts and photo captions on a schedule",
      "Google Ads & LSA manager (manager account, IP exclusions)",
      "Cloudflare + Google Search Console",
      "Domains + Gmail alert forwarding",
      "YouTube and social publishing",
      "Property records lookup",
      "Public API",
      "CSV export of every report",
      "12 months of scan and ranking history",
      "100 permit searches / month",
      "Click Guard + IP Tracker + VPN Shield — 10 websites",
      "15 Site Scans / month",
      "20 ranking-grid credits / month",
      "10 Competitor Intel scans / month",
      "Team text alerts — 1,000 segments / month",
      "Gabe — 1,000 questions / month",
      "Priority email support",
    ],
    notIncluded: [
      CRM_NOT_INCLUDED_LINE,
      CALL_ASSISTANT_NOT_INCLUDED_LINE,
      SEO_NOT_INCLUDED_LINE,
      "Client workspaces, scheduled client reports, permit alerts, grid watches (Agency and up)",
      "A client-texting number on our carrier (add one)",
    ],
    limits: {
      locations: 25, clientWorkspaces: 0, guardCadenceMinutes: 15, gridCredits: 20, gridCreditsPerLocation: 0, competitorScans: 10,
      protectedSites: 10, siteScans: 15, siteScansPerLocation: 0, permitSearches: 100, agencySeats: 5,
      teamTextSegments: 1000, clientTexting: "byo_or_addon", textingNumbersIncluded: 0, autoPublishAiReplies: true, reviewTemplates: 20,
      apiUnitsPerMonth: 50_000, apiRatePerMinute: 60, historyDays: 365, gabeQuestions: 1000,
      ...SEO_PLAN_LIMITS.pro,
    },
    modules: PRO_MODULES,
  },
  growth: {
    key: "growth", name: "Agency", monthlyCents: 19900, annualCents: 199000,
    tagline: "Client workspaces for up to 100 locations.",
    features: [
      "Everything in Pro",
      "100 Google Business Profile locations",
      "10 team seats and 10 client workspaces — roles, bulk actions, email onboarding",
      "1 client-texting number included",
      "SEO taste: 250 tracked keywords and $10 of SEO data / month",
      "Weekly scheduled grid watches",
      "Scheduled client email reports",
      "Permit alerts for new filings in your territory",
      "Unlimited scan and ranking history",
      "50 review reply templates",
      "200 permit searches / month",
      "Click Guard + IP Tracker + VPN Shield — 25 websites",
      "50 Site Scans / month",
      "40 ranking-grid credits / month",
      "20 Competitor Intel scans / month",
      "Team text alerts — 2,000 segments / month",
      "Gabe — 3,000 questions / month",
      "Priority support with a phone callback",
    ],
    notIncluded: [
      CRM_NOT_INCLUDED_LINE,
      CALL_ASSISTANT_NOT_INCLUDED_LINE,
      "The full SEO suite — 5,000 keywords and $60 of data (the SEO add-on, or Unlimited)",
      "White-label reports, the Master Class, unlimited everything (Unlimited)",
    ],
    limits: {
      locations: 100, clientWorkspaces: 10, guardCadenceMinutes: 15, gridCredits: 40, gridCreditsPerLocation: 0, competitorScans: 20,
      protectedSites: 25, siteScans: 50, siteScansPerLocation: 0, permitSearches: 200, agencySeats: 10,
      teamTextSegments: 2000, clientTexting: "included", textingNumbersIncluded: 1, autoPublishAiReplies: true, reviewTemplates: 50,
      apiUnitsPerMonth: 250_000, apiRatePerMinute: 60, historyDays: UNLIMITED, gabeQuestions: 3000,
      ...SEO_PLAN_LIMITS.growth,
    },
    modules: AGENCY_MODULES,
  },
  agency: {
    key: "agency", name: "Unlimited", monthlyCents: 44900, annualCents: 449000,
    tagline: "No caps. The only unlimited plan on the market.",
    features: [
      "Everything in Agency",
      "Unlimited locations, seats, client workspaces and websites",
      "Unlimited (fair use) permit searches, Site Scans and Gabe questions",
      "Profile Guard checks every 5 min",
      "The full SEO suite — 5,000 tracked keywords and $60 of SEO data / month",
      "White-label reports under your own brand",
      "2 client-texting numbers included",
      "150 ranking-grid credits / month",
      "50 Competitor Intel scans / month",
      "Team text alerts — 5,000 segments / month",
      "Unlimited review reply templates",
      "The Master Class course included",
      "GBP reinstatement help at half the standard rate",
      "Two seats on every new product we launch",
      "Named support contact, onboarding call, first access to new features",
    ],
    notIncluded: [
      CRM_NOT_INCLUDED_LINE,
      CALL_ASSISTANT_NOT_INCLUDED_LINE,
    ],
    limits: {
      locations: UNLIMITED, clientWorkspaces: UNLIMITED, guardCadenceMinutes: 5, gridCredits: 150, gridCreditsPerLocation: 0, competitorScans: 50,
      protectedSites: UNLIMITED, siteScans: UNLIMITED, siteScansPerLocation: 0, permitSearches: UNLIMITED, agencySeats: UNLIMITED,
      teamTextSegments: 5000, clientTexting: "included", textingNumbersIncluded: 2, autoPublishAiReplies: true, reviewTemplates: UNLIMITED,
      apiUnitsPerMonth: UNLIMITED, apiRatePerMinute: 120, historyDays: UNLIMITED, gabeQuestions: UNLIMITED,
      ...SEO_PLAN_LIMITS.agency,
    },
    modules: ALL_MODULES,
  },
};

/**
 * LEGACY (2026-09-30 ladder): Agency locations above 10, graduated like tax brackets. Not sold since 2026-10-09 —
 * Unlimited has no location cap — kept so a stored subscription with a band line still reads and bills as it did.
 */
/** The 2026-09-30 Agency base price the bands sat on ($349 for 10 locations). */
export const LEGACY_AGENCY_BASE_CENTS = 34900;
export const AGENCY_LOCATION_BANDS: readonly { upTo: number; centsPerLocation: number }[] = [
  { upTo: 10, centsPerLocation: 0 },
  { upTo: 50, centsPerLocation: 1500 },
  { upTo: 250, centsPerLocation: 1000 },
  { upTo: 500, centsPerLocation: 700 },
];
/** Above this many locations the Agency plan is quoted by sales. */
export const AGENCY_SELF_SERVE_MAX_LOCATIONS = 500;
/**
 * Locations the legacy (2026-09-30) Agency price included before the graduated
 * bands applied. Since 2026-10-09 the `agency` key is Unlimited (no cap), so
 * the band maths and every stored row read THIS constant — never
 * PLANS.agency.limits.locations (-1).
 */
export const LEGACY_AGENCY_INCLUDED_LOCATIONS = AGENCY_LOCATION_BANDS[0].upTo;

/** Monthly Agency bill for a location count (base + graduated bands); null above self-serve. */
export function agencyMonthlyCents(locations: number): number | null {
  if (locations > AGENCY_SELF_SERVE_MAX_LOCATIONS) return null;
  let cents = LEGACY_AGENCY_BASE_CENTS, prev = 0;
  for (const band of AGENCY_LOCATION_BANDS) {
    const inBand = Math.max(0, Math.min(locations, band.upTo) - prev);
    cents += inBand * band.centsPerLocation;
    prev = band.upTo;
  }
  return cents;
}

export type AddonKey =
  | "extra_location" | "extra_seat" | "protected_site" | "texting_number" | "competitor_pack" | "grid_pack" | "seo_basic" | "seo_pro"
  | "call_assistant_lite" | "call_assistant" | "call_assistant_crew" | "call_assistant_fleet" | "call_number";
export type Addon = {
  key: AddonKey;
  name: string;
  description: string;
  monthlyCents: number;
  annualCents: number;
  /** One-time fee charged with the first invoice. */
  setupCents?: number;
  availableOn: PlanKey[];
  /**
   * What one unit adds to the plan's limits (server/entitlements.ts applies
   * it). Empty for an add-on that isn't a count, like the texting number: the
   * texting gate is the plan's own.
   */
  grants: Partial<Record<CountLimitKey, number>>;
  /**
   * Listed on the pricing page as "coming soon" and refused at checkout
   * (server/billing/order.ts) until the owner confirms the price and the
   * feature ships. Drop the flag to start selling it.
   */
  preview?: boolean;
  /**
   * An add-on that only makes sense on top of another one: it needs ANY of
   * these on the same subscription (call_number needs a Call Assistant tier).
   */
  requires?: readonly AddonKey[];
  /**
   * Mutually exclusive add-ons: a subscription holds at most ONE unit of ONE
   * add-on of a group (the Call Assistant tiers). Asking for another member
   * of the group is a switch (server/billing/order.ts mergeAddonRequest,
   * server/voice/subscription.ts): the old one is removed on the same
   * subscription update, prorated.
   */
  exclusiveGroup?: "call_assistant_tier" | "seo_addon";
  /**
   * Introductory monthly price for the first `introMonths` months, once per
   * customer, when the add-on is first added on MONTHLY billing
   * (server/billing/intro.ts). No add-on carries one today — the AI Call
   * Assistant's launch intro ended with the 2026-10-08 repricing — so the
   * fields stay for the records server/billing/intro.ts keeps, nothing more.
   */
  introMonthlyCents?: number;
  introMonths?: number;
};

/**
 * The overage rate for a call when no tier is held at that moment (a platform
 * admin without a tier — whose minutes are unlimited, so it never applies; a
 * call that ends just after a cancellation keeps the month's snapshot): the
 * one rate every tier has.
 */
export const CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS = CALL_ASSISTANT_OVERAGE_CENTS_PER_MINUTE;
/** Every distinct overage rate, highest first (one today; the meter and the Stripe price lookup are per rate). */
export const CALL_ASSISTANT_OVERAGE_RATES: readonly number[] = [...new Set(CALL_ASSISTANT_TIERS.map((t) => t.overageCentsPerMinute))].sort((a, b) => b - a);
/**
 * Spam calls per org per calendar month (UTC) whose minutes never count
 * toward the included minutes or overage — every tier. A call blocked before
 * answering costs no minutes at all (it is rejected), so only screened spam
 * calls that were answered use this allowance; above it they count like any
 * call (server/voice/billing-usage.ts recordVoiceCallUsage).
 */
export const CALL_ASSISTANT_FREE_SPAM_CALLS = 500;
/** For "which tier do I need": the average call length the estimates assume (an estimate, not a promise). */
export const CALL_ASSISTANT_ESTIMATE_MINUTES_PER_CALL = 2;

/**
 * The Call Assistant's add-ons are sold on NO platform plan: they are the
 * lines of the Call Assistant's own subscription (server/voice/subscription.ts).
 * `availableOn` is empty so the platform checkout refuses them
 * (server/billing/order.ts checkAddonsForPlan) and no plan page lists them.
 */
const CALL_ASSISTANT_SOLD_ON: PlanKey[] = [];

function callAssistantTierAddon(key: CallAssistantTierKey): Addon {
  const t = CALL_ASSISTANT_TIERS.find((x) => x.tier === key)!;
  const numbers = `${t.includedNumbers} local number${t.includedNumbers === 1 ? "" : "s"}`;
  return {
    key: t.addon,
    name: `${CALL_ASSISTANT_NAME} — ${t.name}`,
    description: `An AI receptionist that answers your phone 24/7, screens out spam, fills in the lead for your CRM and texts the right person. ${t.includedMinutes.toLocaleString("en-US")} call minutes a month and ${numbers}, then $${(t.overageCentsPerMinute / 100).toFixed(2)} a minute; the first ${CALL_ASSISTANT_FREE_SPAM_CALLS} spam calls each month never count.`,
    monthlyCents: t.monthlyCents,
    annualCents: t.annualCents,
    availableOn: CALL_ASSISTANT_SOLD_ON,
    grants: {},
    exclusiveGroup: "call_assistant_tier",
  };
}

export const ADDONS: Record<AddonKey, Addon> = {
  // RETIRED 2026-10-09 (owner: "outgrow a plan, move up" — no extra-location add-on below Unlimited). Sold on no plan;
  // the key stays so a stored subscription that holds one still reads.
  extra_location: { key: "extra_location", name: "Extra location", description: "One more Google Business Profile location. No longer sold: a bigger plan includes more.", monthlyCents: 1900, annualCents: 19000, availableOn: [], grants: { locations: 1 } },
  extra_seat: { key: "extra_seat", name: "Extra team seat", description: "One more team seat.", monthlyCents: 1500, annualCents: 15000, availableOn: ["team", "pro", "growth"], grants: { agencySeats: 1 } },
  protected_site: { key: "protected_site", name: "Extra protected website", description: "Click Guard + IP Tracker + VPN Shield for one more website.", monthlyCents: 1500, annualCents: 15000, availableOn: ["starter", "team", "pro", "growth"], grants: { protectedSites: 1 } },
  texting_number: { key: "texting_number", name: "Client texting number", description: "A registered texting number on our carrier for texting your clients; texts count against your plan's monthly text allowance.", monthlyCents: 2900, annualCents: 29000, setupCents: 2900, availableOn: ["starter", "team", "pro", "growth", "agency"], grants: {} },
  competitor_pack: { key: "competitor_pack", name: "Competitor scan pack", description: "10 more Competitor Intel scans each month.", monthlyCents: 1900, annualCents: 19000, availableOn: ["starter", "team", "pro", "growth", "agency"], grants: { competitorScans: 10 } },
  grid_pack: { key: "grid_pack", name: "Grid scan pack", description: "10 more ranking-grid credits each month.", monthlyCents: 1000, annualCents: 10000, availableOn: ["starter", "team", "pro", "growth", "agency"], grants: { gridCredits: 10 } },
  // ── ConstructHUB SEO as an add-on (owner, 2026-10-09): the suite on any plan below Unlimited. One of the two per account.
  seo_basic: { key: "seo_basic", name: "SEO suite — 1,000 keywords", description: "Site explorer, rank tracker, keyword research and backlinks: 1,000 tracked keywords and $20 of SEO data a month.", monthlyCents: 2900, annualCents: 29000, availableOn: ["starter", "team", "pro", "growth"], grants: { seoKeywords: 1000, seoCreditCents: 2000 }, exclusiveGroup: "seo_addon" },
  seo_pro: { key: "seo_pro", name: "SEO suite — 5,000 keywords", description: "The full suite: 5,000 tracked keywords and $60 of SEO data a month (what Unlimited includes).", monthlyCents: 7900, annualCents: 79000, availableOn: ["starter", "team", "pro", "growth"], grants: { seoKeywords: 5000, seoCreditCents: 6000 }, exclusiveGroup: "seo_addon" },
  // ── Call Assistant (docs/call-assistant/SPEC.md) — a separate service ────
  // The four tiers (CALL_ASSISTANT_TIERS above), one per account
  // (exclusiveGroup), and the extra number: the lines of the Call Assistant's
  // OWN Stripe subscription (server/voice/subscription.ts), never of a platform
  // plan's. The second tier keeps the original `call_assistant` key, so every
  // code path that reads `call_assistant` still reads a tier. Each key has its
  // own Stripe price, found by lookup key from the cents (server/billing/prices.ts
  // addonPriceSpec), so the 2026-10-08 prices made new Stripe Prices on the next
  // checkout — nothing manual. The tiers' yearly prices are
  // CALL_ASSISTANT_ANNUAL_MONTHS (11) × monthly; the extra number stays at the
  // plans' 10 × ($5/mo, $50/yr — unchanged), like every other add-on.
  // The number is part of the service (owner, 2026-10-02): when the
  // subscription ends or the tier is removed, the org's numbers are released
  // (server/voice/number-release.ts); a failed payment pauses the assistant
  // (ADDON_MODULE_RUN_STATUSES) but keeps the number. Launched (owner,
  // 2026-10-02: "the call assistant is live not coming soon"): nothing here is
  // `preview` — every tier and the extra number are for sale.
  call_assistant_lite: callAssistantTierAddon("lite"),
  call_assistant: callAssistantTierAddon("solo"),
  call_assistant_crew: callAssistantTierAddon("crew"),
  call_assistant_fleet: callAssistantTierAddon("fleet"),
  call_number: {
    key: "call_number", name: "Extra Call Assistant number",
    description: "One more local number for the AI Call Assistant (a second location or a tracking line).",
    // $50/yr: the old contract (10 × monthly, like the plans). The owner's 2026-10-08 repricing named the four
    // tiers only; the extra number's prices are unchanged (Codex audit #4).
    monthlyCents: 500, annualCents: 5000, availableOn: CALL_ASSISTANT_SOLD_ON, grants: {},
    requires: CALL_ASSISTANT_TIER_ADDONS,
  },
};

/** Every add-on that is a line of the Call Assistant's own subscription (the tiers and the extra number). */
export const CALL_ASSISTANT_ADDONS: readonly AddonKey[] = [...CALL_ASSISTANT_TIER_ADDONS, "call_number"];
export const isCallAssistantAddon = (key: AddonKey): boolean => CALL_ASSISTANT_ADDONS.includes(key);
/** The add-on quantities a Call Assistant subscription holds, in the shape every voice code path reads ({ call_assistant_crew: 1, call_number: 2 }). */
export function callAssistantAddonsOf(tier: CallAssistantTierKey | null | undefined, extraNumbers = 0): Partial<Record<AddonKey, number>> {
  const out: Partial<Record<AddonKey, number>> = {};
  const held = tier ? CALL_ASSISTANT_TIERS.find((t) => t.tier === tier) : null;
  if (!held) return out;
  out[held.addon] = 1;
  // An extra number needs a tier (ADDONS.call_number.requires): without one it buys nothing.
  if (extraNumbers > 0) out.call_number = Math.floor(extraNumbers);
  return out;
}
/** A quantities map without the Call Assistant's add-ons: what a PLATFORM subscription may carry (a stale row never grants the service). */
export function withoutCallAssistantAddons(addons: Partial<Record<AddonKey, number>>): Partial<Record<AddonKey, number>> {
  const out: Partial<Record<AddonKey, number>> = {};
  for (const [key, qty] of Object.entries(addons) as [AddonKey, number][]) if (!isCallAssistantAddon(key)) out[key] = qty;
  return out;
}
/** A stored tier key as CallAssistantTierKey, or null for anything else. */
export const callAssistantTierKey = (value: unknown): CallAssistantTierKey | null =>
  CALL_ASSISTANT_TIERS.some((t) => t.tier === value) ? (value as CallAssistantTierKey) : null;

/** SignalWire keeps a purchased number for at least this long before it can be released. */
export const CALL_NUMBER_MIN_DAYS = 14;

/** The tier an add-on key sells, or null. */
export function callAssistantTierForAddon(addon: string | null | undefined): CallAssistantTier | null {
  return CALL_ASSISTANT_TIERS.find((t) => t.addon === addon) ?? null;
}
export const callAssistantTier = (key: CallAssistantTierKey): CallAssistantTier => CALL_ASSISTANT_TIERS.find((t) => t.tier === key)!;

/**
 * The tier a set of add-on quantities holds, or null. Exactly one is the rule
 * (order.ts refuses two); a row that somehow carries two reads as the larger.
 */
export function callAssistantTierOf(addons: Partial<Record<AddonKey, number>> | null | undefined): CallAssistantTier | null {
  let held: CallAssistantTier | null = null;
  for (const t of CALL_ASSISTANT_TIERS) if ((addons?.[t.addon] ?? 0) > 0) held = t;
  return held;
}

/** What the held tier includes (0 / 0 without one). Extra numbers (call_number) are on top. */
export function callAssistantIncluded(addons: Partial<Record<AddonKey, number>> | null | undefined): { tier: CallAssistantTier | null; numbers: number; minutes: number; overageCentsPerMinute: number } {
  const tier = callAssistantTierOf(addons);
  return { tier, numbers: tier?.includedNumbers ?? 0, minutes: tier?.includedMinutes ?? 0, overageCentsPerMinute: tier?.overageCentsPerMinute ?? CALL_ASSISTANT_DEFAULT_OVERAGE_CENTS };
}

/**
 * Modules unlocked by BUYING an add-on rather than by the plan alone. The plan
 * only decides whether the add-on is for sale (`availableOn`); the entitlement
 * (server/entitlements.ts `addonModules`) is on when the add-on is on the
 * subscription. `requireModule("callAssistant")` gates the routes.
 */
export type AddonModuleKey = "callAssistant";
/** The add-on an upgrade prompt offers for the module (the entry tier). */
export const ADDON_MODULES: Record<AddonModuleKey, AddonKey> = { callAssistant: "call_assistant" };
/** Every add-on that unlocks the module (any one Call Assistant tier). */
export const ADDON_MODULE_UNLOCKED_BY: Record<AddonModuleKey, readonly AddonKey[]> = { callAssistant: CALL_ASSISTANT_TIER_ADDONS };
export const ADDON_MODULE_NAMES: Record<AddonModuleKey, string> = { callAssistant: CALL_ASSISTANT_NAME };
/** A plan-level module or an add-on module — what requireModule accepts. */
export type AnyModuleKey = ModuleKey | AddonModuleKey;
export const isAddonModule = (module: AnyModuleKey): module is AddonModuleKey => module in ADDON_MODULES;
/** The human name of any module, for upgrade prompts. */
export function moduleName(module: AnyModuleKey): string {
  return isAddonModule(module) ? ADDON_MODULE_NAMES[module] : MODULE_NAMES[module];
}

export const TRIAL_DAYS = 1;
/** GBP Reinstatement service, per project (one price for the page, the cards and the Hub assistant). */
export const GBP_REINSTATEMENT_CENTS = 59_900;
/** Services at or above this price show "Talk to a sales rep" instead of a price. */
export const SALES_THRESHOLD_CENTS = 100_000;
export const showsPrice = (cents: number) => cents < SALES_THRESHOLD_CENTS;

/**
 * Plan keys sold before 2026-09-30. Existing subscriptions keep their Stripe
 * price until they change plans; their entitlements follow the nearest new plan.
 */
export const LEGACY_PLAN_MAP: Record<string, PlanKey> = {
  standard: "starter", professional: "starter", business: "pro", premium: "pro", gold: "growth", platinum: "agency",
};

/**
 * Subscription statuses that keep the plan's features: paid up (`active`) or in the trial (`trialing`). Owner,
 * 2026-10-04: "when a payment fails … did you fix that" — a failed payment no longer keeps the plan on. `past_due`
 * (Stripe retrying a failed renewal), `unpaid`, `incomplete`, `paused` and `canceled` have no access; the app shows
 * "Your last payment didn't go through · Update card" (PAYMENT_NEEDED_STATUSES) and the moment Stripe collects, the
 * webhook moves the subscription back to active and everything returns — nothing to re-buy, nothing lost. This no
 * longer depends on the Stripe Dashboard's failed-payment setting.
 */
export const ACCESS_STATUSES: readonly string[] = ["active", "trialing"];

/**
 * Subscription statuses under which an add-on MODULE runs (the AI Call
 * Assistant answers calls). Stricter than ACCESS_STATUSES on purpose — owner,
 * 2026-10-02: "As soon as they stop paying the agent stops working." The plan
 * itself now stops on past_due too (ACCESS_STATUSES).
 */
export const ADDON_MODULE_RUN_STATUSES: readonly string[] = ["active", "trialing"];
/**
 * Statuses that mean "a payment is needed" rather than "the subscription
 * ended": the add-on is paused, not gone. Fixing the card restores it.
 */
export const PAYMENT_NEEDED_STATUSES: readonly string[] = ["past_due", "unpaid", "incomplete", "paused"];
/**
 * Statuses on which the subscription has ENDED for the Call Assistant number:
 * its numbers are released (server/voice/number-release.ts). past_due is never
 * here — the number is held so fixing the card restores the agent. `inactive`
 * is a row that never had (or no longer has) a subscription.
 */
export const NUMBER_RELEASE_STATUSES: readonly string[] = ["canceled", "unpaid", "incomplete_expired", "inactive"];

/** A stored plan key (current or legacy) as the plan it maps to, whatever the status; null for "free" or unknown. */
export function storedPlanKey(plan: string | null | undefined): PlanKey | null {
  if (!plan) return null;
  if ((PLAN_KEYS as readonly string[]).includes(plan)) return plan as PlanKey;
  return LEGACY_PLAN_MAP[plan] ?? null;
}

/** Resolve a stored subscription row to the plan whose entitlements apply, or null (no active plan). */
export function effectivePlanKey(sub: { plan?: string | null; status?: string | null } | null | undefined): PlanKey | null {
  if (!sub?.plan || !ACCESS_STATUSES.includes(sub.status ?? "")) return null;
  return storedPlanKey(sub.plan);
}

/**
 * The cheapest plan that includes a module (for upgrade prompts). For an
 * add-on module it is the cheapest plan the add-on is sold on.
 */
export function planForModule(module: AnyModuleKey): PlanKey {
  if (isAddonModule(module)) return ADDONS[ADDON_MODULES[module]].availableOn[0] ?? "agency";
  // A "coming" module is on the plans that promise it; the cheapest of those is still the honest answer.
  return PLAN_KEYS.find((k) => PLANS[k].modules[module]) ?? "agency";
}

/** Human names for modules, for upgrade messages. */
export const MODULE_NAMES: Record<ModuleKey, string> = {
  agencyWorkspace: "Agency workspace",
  adsManager: "Google Ads & LSA manager",
  cloudflareSearchConsole: "Cloudflare + Search Console",
  domainsMailAlerts: "Domains + Gmail alerts",
  autoPosts: "AI posts on a schedule",
  reviewReminders: "Review reminders",
  propertyRecords: "Property records",
  socialPublishing: "YouTube and social publishing",
  csvExport: "CSV export",
  scheduledReports: "Scheduled client reports",
  permitAlerts: "Permit alerts",
  gridWatches: "Scheduled grid watches",
  whiteLabel: "White-label reports",
  masterClass: "Master Class",
};

// ---------------------------------------------------------------------------
// Billing helpers (checkout, the Stripe sync, the pricing page). Everything
// below is derived from the tables above — no price lives here twice.

export const BILLING_INTERVALS: readonly BillingInterval[] = ["month", "year"];
export const ADDON_KEYS = Object.keys(ADDONS) as AddonKey[];
/** Annual billing is this many months of the monthly price — plans, add-ons and Agency bands alike. */
export const ANNUAL_MONTHS = 10;
/** The most of one add-on a self-serve order may hold; a bigger order is a sales conversation. */
export const ADDON_MAX_QUANTITY = 100;
/**
 * `code` on the server's 409 refusal for anything sold only through a sales rep
 * (price at or above SALES_THRESHOLD_CENTS, Agency above 500 locations, very
 * large add-on orders). The client shows "Talk to a sales rep" + the inquiry form.
 */
export const TALK_TO_SALES_CODE = "talk_to_sales";

export const isPlanKey = (value: unknown): value is PlanKey =>
  typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
export const isAddonKey = (value: unknown): value is AddonKey =>
  typeof value === "string" && (ADDON_KEYS as readonly string[]).includes(value);
export const isBillingInterval = (value: unknown): value is BillingInterval =>
  value === "month" || value === "year";

export const planPriceCents = (plan: PlanKey, interval: BillingInterval) =>
  interval === "year" ? PLANS[plan].annualCents : PLANS[plan].monthlyCents;
export const addonPriceCents = (addon: AddonKey, interval: BillingInterval) =>
  interval === "year" ? ADDONS[addon].annualCents : ADDONS[addon].monthlyCents;
export const addonAvailableOn = (addon: AddonKey, plan: PlanKey) => ADDONS[addon].availableOn.includes(plan);

/** Agency locations above the included ones — what the per-location band item bills. */
export function agencyExtraLocations(locations: number): number {
  // LEGACY: Unlimited has no location cap, so nothing is ever extra; the bands only read old rows (AGENCY_LOCATION_BANDS).
  return Math.max(0, Math.floor(locations) - AGENCY_LOCATION_BANDS[0].upTo);
}

/** Agency bill per interval for a location count (base + graduated bands); null above self-serve. */
export function agencyPriceCents(locations: number, interval: BillingInterval): number | null {
  const monthly = agencyMonthlyCents(locations);
  if (monthly === null) return null;
  return interval === "year" ? monthly * ANNUAL_MONTHS : monthly;
}

/**
 * The most extra-location add-ons a non-Agency plan can hold: 10 or more
 * locations is the Agency plan (see ADDONS.extra_location).
 */
export function maxExtraLocations(_plan: PlanKey): number {
  // 2026-10-09: the extra-location add-on is retired (ADDONS.extra_location.availableOn is empty).
  return 0;
}

/**
 * Ranking-grid credits a grid costs: one credit per 25 grid points, rounded up
 * (3x3 and 5x5 = 1, 7x7 = 2, 9x9 = 4, 11x11 = 5, 13x13 = 7, 15x15 = 9). The
 * Places cost of a grid grows with its points, so credits do too. The server
 * charges this (server/growth-quotas.ts); the client can show it beside the
 * grid-size picker.
 */
export function gridCreditCost(gridSize: number): number {
  const size = Math.max(1, Math.floor(Number(gridSize) || 3));
  return Math.ceil((size * size) / 25);
}
