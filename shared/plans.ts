/**
 * The price book and what each plan gets — the single source of truth for the
 * server (checkout, entitlements, quotas) and the client (pricing page, upgrade
 * prompts). Owner decisions 2026-09-30:
 *   - Starter $29 / Pro $79 / Growth $199 / Agency $349 (10 locations, then
 *     graduated per-location bands; quote above 500). Annual = 10x monthly.
 *   - No free plan; a 1-day trial.
 *   - Agency workspace, Google Ads/LSA manager, Cloudflare + Search Console and
 *     Domains + Gmail alerts are Agency-only.
 *   - Single features are bought as add-ons, not standalone tools.
 *   - Anything priced at $1,000 or more is "Talk to a sales rep", never a price.
 * Money is in cents.
 */

export type PlanKey = "starter" | "pro" | "growth" | "agency";
export const PLAN_KEYS: readonly PlanKey[] = ["starter", "pro", "growth", "agency"];
export type BillingInterval = "month" | "year";

/** -1 means unlimited (fair use). */
export type PlanLimits = {
  /** Google Business Profile locations included (Agency adds paid bands above this). */
  locations: number;
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
  crmSeats: number;
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
};

/** The numeric limits (the ones an add-on can raise). */
export type CountLimitKey = { [K in keyof PlanLimits]: PlanLimits[K] extends number ? K : never }[keyof PlanLimits];

export type PlanModules = {
  agencyWorkspace: boolean;
  adsManager: boolean;
  cloudflareSearchConsole: boolean;
  domainsMailAlerts: boolean;
};
export type ModuleKey = keyof PlanModules;

export type Plan = {
  key: PlanKey;
  name: string;
  monthlyCents: number;
  annualCents: number;
  tagline: string;
  /** Marketing bullets, in display order. Must match `limits`/`modules`. */
  features: string[];
  limits: PlanLimits;
  modules: PlanModules;
};

const NO_MODULES: PlanModules = { agencyWorkspace: false, adsManager: false, cloudflareSearchConsole: false, domainsMailAlerts: false };

export const PLANS: Record<PlanKey, Plan> = {
  starter: {
    key: "starter", name: "Starter", monthlyCents: 2900, annualCents: 29000,
    tagline: "One Google profile, managed and protected.",
    features: [
      "1 Google Business Profile location",
      "Profile Guard edit alerts (checks every 15 min)",
      "Review alerts, AI reply drafts, AI posts & photo captions",
      "5 ranking-grid credits / month",
      "2 Site Scans / month",
      "100 permit searches / month",
      "CRM: estimates, invoices, payments — 1 seat",
      "Email support",
    ],
    limits: {
      locations: 1, guardCadenceMinutes: 15, gridCredits: 5, gridCreditsPerLocation: 0, competitorScans: 0,
      protectedSites: 0, siteScans: 2, siteScansPerLocation: 0, permitSearches: 100, crmSeats: 1,
      teamTextSegments: 0, clientTexting: "none", autoPublishAiReplies: false, reviewTemplates: 5,
      apiUnitsPerMonth: 0, apiRatePerMinute: 60,
    },
    modules: NO_MODULES,
  },
  pro: {
    key: "pro", name: "Pro", monthlyCents: 7900, annualCents: 79000,
    tagline: "Adds click-fraud protection, competitors and texting.",
    features: [
      "Everything in Starter",
      "AI review replies can publish automatically",
      "Click Guard + IP Tracker + VPN Shield — 1 website",
      "2 Competitor Intel scans / month",
      "15 ranking-grid credits / month",
      "5 Site Scans / month",
      "500 permit searches / month",
      "CRM — 3 seats, team text alerts (500 / month)",
      "Client texting with your own SignalWire number (or the texting add-on)",
      "Priority email support",
    ],
    limits: {
      locations: 1, guardCadenceMinutes: 15, gridCredits: 15, gridCreditsPerLocation: 0, competitorScans: 2,
      protectedSites: 1, siteScans: 5, siteScansPerLocation: 0, permitSearches: 500, crmSeats: 3,
      teamTextSegments: 500, clientTexting: "byo_or_addon", autoPublishAiReplies: true, reviewTemplates: 20,
      apiUnitsPerMonth: 10_000, apiRatePerMinute: 60,
    },
    modules: NO_MODULES,
  },
  growth: {
    key: "growth", name: "Growth", monthlyCents: 19900, annualCents: 199000,
    tagline: "Multi-location contractors with a team.",
    features: [
      "Everything in Pro",
      "3 Google Business Profile locations",
      "Click Guard + IP Tracker + VPN Shield — 3 websites",
      "8 Competitor Intel scans / month",
      "30 ranking-grid credits / month",
      "15 Site Scans / month",
      "5,000 permit searches / month",
      "CRM — 10 seats, team text alerts (1,500 / month)",
      "1 client-texting number included (500 texts / month)",
      "Priority support + onboarding call",
    ],
    limits: {
      locations: 3, guardCadenceMinutes: 15, gridCredits: 30, gridCreditsPerLocation: 0, competitorScans: 8,
      protectedSites: 3, siteScans: 15, siteScansPerLocation: 0, permitSearches: 5000, crmSeats: 10,
      teamTextSegments: 1500, clientTexting: "included", autoPublishAiReplies: true, reviewTemplates: 20,
      apiUnitsPerMonth: 50_000, apiRatePerMinute: 60,
    },
    modules: NO_MODULES,
  },
  agency: {
    key: "agency", name: "Agency", monthlyCents: 34900, annualCents: 349000,
    tagline: "For SEO companies managing many client profiles.",
    features: [
      "10 client locations included, then per-location pricing",
      "Agency workspace: client workspaces, bulk actions, email onboarding",
      "Team roles — owner, admin, manager, viewer (10 seats, shared with the CRM team)",
      "Google Ads & LSA manager (manager account, IP exclusions)",
      "Cloudflare + Google Search Console",
      "Domains + Gmail alert forwarding",
      "Click Guard + IP Tracker + VPN Shield — 10 websites",
      "20 Competitor Intel scans / month",
      "2 ranking-grid credits and 1 Site Scan per location / month",
      "Priority support + onboarding",
    ],
    limits: {
      locations: 10, guardCadenceMinutes: 30, gridCredits: 0, gridCreditsPerLocation: 2, competitorScans: 20,
      protectedSites: 10, siteScans: 0, siteScansPerLocation: 1, permitSearches: 5000, crmSeats: 10,
      teamTextSegments: 1500, clientTexting: "byo_or_addon", autoPublishAiReplies: true, reviewTemplates: 50,
      apiUnitsPerMonth: 250_000, apiRatePerMinute: 60,
    },
    modules: { agencyWorkspace: true, adsManager: true, cloudflareSearchConsole: true, domainsMailAlerts: true },
  },
};

/** Agency locations above the 10 included, graduated like tax brackets. */
export const AGENCY_LOCATION_BANDS: readonly { upTo: number; centsPerLocation: number }[] = [
  { upTo: 10, centsPerLocation: 0 },
  { upTo: 50, centsPerLocation: 1500 },
  { upTo: 250, centsPerLocation: 1000 },
  { upTo: 500, centsPerLocation: 700 },
];
/** Above this many locations the Agency plan is quoted by sales. */
export const AGENCY_SELF_SERVE_MAX_LOCATIONS = 500;

/** Monthly Agency bill for a location count (base + graduated bands); null above self-serve. */
export function agencyMonthlyCents(locations: number): number | null {
  if (locations > AGENCY_SELF_SERVE_MAX_LOCATIONS) return null;
  let cents = PLANS.agency.monthlyCents, prev = 0;
  for (const band of AGENCY_LOCATION_BANDS) {
    const inBand = Math.max(0, Math.min(locations, band.upTo) - prev);
    cents += inBand * band.centsPerLocation;
    prev = band.upTo;
  }
  return cents;
}

export type AddonKey = "extra_location" | "extra_seat" | "protected_site" | "texting_number" | "competitor_pack";
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
};
export const ADDONS: Record<AddonKey, Addon> = {
  extra_location: { key: "extra_location", name: "Extra location", description: "One more Google Business Profile location (10+ locations: Agency).", monthlyCents: 1900, annualCents: 19000, availableOn: ["starter", "pro", "growth"], grants: { locations: 1 } },
  extra_seat: { key: "extra_seat", name: "Extra seat", description: "One more CRM or agency team seat.", monthlyCents: 1500, annualCents: 15000, availableOn: ["starter", "pro", "growth", "agency"], grants: { crmSeats: 1 } },
  protected_site: { key: "protected_site", name: "Extra protected website", description: "Click Guard + IP Tracker + VPN Shield for one more website.", monthlyCents: 1500, annualCents: 15000, availableOn: ["pro", "growth", "agency"], grants: { protectedSites: 1 } },
  texting_number: { key: "texting_number", name: "Client texting number", description: "A registered texting number on our carrier: 500 texts / month, then $0.02 each.", monthlyCents: 2900, annualCents: 29000, setupCents: 2900, availableOn: ["pro", "agency"], grants: {} },
  competitor_pack: { key: "competitor_pack", name: "Competitor scan pack", description: "10 more Competitor Intel scans each month.", monthlyCents: 3900, annualCents: 39000, availableOn: ["pro", "growth", "agency"], grants: { competitorScans: 10 } },
};

export const TRIAL_DAYS = 1;
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
 * Subscription statuses that keep the plan's features. `past_due` is a Stripe
 * subscription whose renewal payment failed while Stripe retries the card:
 * access stays on through the retries. When the retries fail, Stripe moves the
 * subscription to canceled or unpaid (both without access) only if the Stripe
 * Dashboard's failed-payment setting says so; "leave the subscription past-due"
 * would keep access on with no end, so that setting must not be chosen. `incomplete`
 * (the first payment never went through), `incomplete_expired`, `unpaid`,
 * `paused` and `canceled` have no access.
 */
export const ACCESS_STATUSES: readonly string[] = ["active", "trialing", "past_due"];

/** Resolve a stored subscription row to the plan whose entitlements apply, or null (no active plan). */
export function effectivePlanKey(sub: { plan?: string | null; status?: string | null } | null | undefined): PlanKey | null {
  if (!sub?.plan || !ACCESS_STATUSES.includes(sub.status ?? "")) return null;
  if ((PLAN_KEYS as readonly string[]).includes(sub.plan)) return sub.plan as PlanKey;
  return LEGACY_PLAN_MAP[sub.plan] ?? null;
}

/** The cheapest plan that includes a module (for upgrade prompts). */
export function planForModule(module: ModuleKey): PlanKey {
  return PLAN_KEYS.find((k) => PLANS[k].modules[module]) ?? "agency";
}

/** Human names for modules, for upgrade messages. */
export const MODULE_NAMES: Record<ModuleKey, string> = {
  agencyWorkspace: "Agency workspace",
  adsManager: "Google Ads & LSA manager",
  cloudflareSearchConsole: "Cloudflare + Search Console",
  domainsMailAlerts: "Domains + Gmail alerts",
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
  return Math.max(0, Math.floor(locations) - PLANS.agency.limits.locations);
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
export function maxExtraLocations(plan: PlanKey): number {
  if (plan === "agency") return 0;
  return Math.max(0, PLANS.agency.limits.locations - 1 - PLANS[plan].limits.locations);
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
