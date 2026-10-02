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

export type AddonKey =
  | "extra_location" | "extra_seat" | "protected_site" | "texting_number" | "competitor_pack"
  | "call_assistant" | "call_assistant_crew" | "call_assistant_fleet" | "call_number";
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
   * of the group is a switch (server/billing/order.ts applyExclusiveSwitch):
   * the old one is removed on the same subscription update, prorated.
   */
  exclusiveGroup?: "call_assistant_tier";
  /**
   * Introductory monthly price for the first `introMonths` months, once per
   * customer, when the add-on is first added on MONTHLY billing
   * (server/billing/intro.ts: a Stripe coupon worth monthlyCents −
   * introMonthlyCents a month). Annual billing has no intro: its price is
   * `annualCents` from the first invoice.
   */
  introMonthlyCents?: number;
  introMonths?: number;
};
// ── AI Call Assistant tiers ─────────────────────────────────────────────────
// Owner, 2026-10-02: three tiers ("companies that will get 3-5k min used a
// month"), overage "we can charge 10 cents", and "all plans cover 500 spam
// calls that aren't charged". Carrier cost for scale: SignalWire bills us
// about $0.0096 per inbound minute (rounded up per call).

export type CallAssistantTierKey = "solo" | "crew" | "fleet";
export type CallAssistantTier = {
  tier: CallAssistantTierKey;
  /** The add-on key that sells this tier (Solo keeps the original `call_assistant`). */
  addon: AddonKey;
  name: string;
  monthlyCents: number;
  /** Its own yearly price (not ANNUAL_MONTHS × monthly). */
  annualCents: number;
  /** Call minutes included each calendar month (UTC). */
  includedMinutes: number;
  /** Local numbers included (more are the call_number add-on). */
  includedNumbers: number;
  /** Monthly-billing intro, first time the Call Assistant is added (Solo only). */
  introMonthlyCents?: number;
  introMonths?: number;
};
/** Cheapest first. The order is the upgrade order. */
export const CALL_ASSISTANT_TIERS: readonly CallAssistantTier[] = [
  { tier: "solo", addon: "call_assistant", name: "Solo", monthlyCents: 24900, annualCents: 199900, includedMinutes: 2000, includedNumbers: 1, introMonthlyCents: 9900, introMonths: 3 },
  { tier: "crew", addon: "call_assistant_crew", name: "Crew", monthlyCents: 44900, annualCents: 359900, includedMinutes: 5000, includedNumbers: 3 },
  { tier: "fleet", addon: "call_assistant_fleet", name: "Fleet", monthlyCents: 79900, annualCents: 639900, includedMinutes: 12000, includedNumbers: 5 },
];
export const CALL_ASSISTANT_TIER_ADDONS: readonly AddonKey[] = CALL_ASSISTANT_TIERS.map((t) => t.addon);
/** The product's name; each tier's add-on is "<this> — <tier name>". */
export const CALL_ASSISTANT_NAME = "AI Call Assistant";
/** Metered minutes above a tier's included minutes, in cents per minute — every tier. */
export const CALL_MINUTE_OVERAGE_CENTS = 10;
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

const CALL_ASSISTANT_SOLD_ON: PlanKey[] = ["pro", "growth", "agency"];

function callAssistantTierAddon(key: CallAssistantTierKey): Addon {
  const t = CALL_ASSISTANT_TIERS.find((x) => x.tier === key)!;
  const numbers = `${t.includedNumbers} local number${t.includedNumbers === 1 ? "" : "s"}`;
  return {
    key: t.addon,
    name: `${CALL_ASSISTANT_NAME} — ${t.name}`,
    description: `An AI receptionist that answers your phone 24/7, screens out spam, fills in the lead for your CRM and texts the right person. ${t.name}: ${numbers} and ${t.includedMinutes.toLocaleString("en-US")} call minutes / month, then $${(CALL_MINUTE_OVERAGE_CENTS / 100).toFixed(2)} / minute; ${CALL_ASSISTANT_FREE_SPAM_CALLS} spam calls a month never count.`,
    monthlyCents: t.monthlyCents,
    annualCents: t.annualCents,
    availableOn: CALL_ASSISTANT_SOLD_ON,
    grants: {},
    preview: true,
    exclusiveGroup: "call_assistant_tier",
    ...(t.introMonthlyCents ? { introMonthlyCents: t.introMonthlyCents, introMonths: t.introMonths } : {}),
  };
}

export const ADDONS: Record<AddonKey, Addon> = {
  extra_location: { key: "extra_location", name: "Extra location", description: "One more Google Business Profile location (10+ locations: Agency).", monthlyCents: 1900, annualCents: 19000, availableOn: ["starter", "pro", "growth"], grants: { locations: 1 } },
  extra_seat: { key: "extra_seat", name: "Extra seat", description: "One more CRM or agency team seat.", monthlyCents: 1500, annualCents: 15000, availableOn: ["starter", "pro", "growth", "agency"], grants: { crmSeats: 1 } },
  protected_site: { key: "protected_site", name: "Extra protected website", description: "Click Guard + IP Tracker + VPN Shield for one more website.", monthlyCents: 1500, annualCents: 15000, availableOn: ["pro", "growth", "agency"], grants: { protectedSites: 1 } },
  texting_number: { key: "texting_number", name: "Client texting number", description: "A registered texting number on our carrier: 500 texts / month, then $0.02 each.", monthlyCents: 2900, annualCents: 29000, setupCents: 2900, availableOn: ["pro", "agency"], grants: {} },
  competitor_pack: { key: "competitor_pack", name: "Competitor scan pack", description: "10 more Competitor Intel scans each month.", monthlyCents: 3900, annualCents: 39000, availableOn: ["pro", "growth", "agency"], grants: { competitorScans: 10 } },
  // ── Call Assistant (docs/call-assistant/SPEC.md) ─────────────────────────
  // Three tiers (owner, 2026-10-02: "We should offer 3 different tiers for the
  // call assistant because there are companies that will get 3-5k min used a
  // month"), one per subscription (exclusiveGroup), built by callAssistantTierAddon
  // below from CALL_ASSISTANT_TIERS. Solo keeps the original `call_assistant`
  // key — same price, same Stripe lookup keys and intro grants — so a row that
  // already holds `call_assistant` IS Solo with no migration. Crew and Fleet
  // are their own add-on keys (own Stripe prices, chub_v1_addon_<key>_…).
  // Owner, 2026-10-02: "$99 a month for the first 3 months" (Solo, monthly
  // billing only), "annually price can be $1999" (Solo). The annual prices are
  // NOT ANNUAL_MONTHS × monthly: each is its own number.
  // The number is part of the service (owner, 2026-10-02): when the
  // subscription ends or the tier is removed, the org's numbers are released
  // (server/voice/number-release.ts); a failed payment pauses the assistant
  // (ADDON_MODULE_RUN_STATUSES) but keeps the number. Every tier stays
  // `preview` (listed, not sellable) until the owner launches it.
  call_assistant: callAssistantTierAddon("solo"),
  call_assistant_crew: callAssistantTierAddon("crew"),
  call_assistant_fleet: callAssistantTierAddon("fleet"),
  call_number: {
    key: "call_number", name: "Extra Call Assistant number",
    description: "One more local number for the AI Call Assistant (a second location or a tracking line).",
    monthlyCents: 500, annualCents: 5000, availableOn: ["pro", "growth", "agency"], grants: {}, preview: true,
    requires: ["call_assistant", "call_assistant_crew", "call_assistant_fleet"],
  },
};

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
export function callAssistantIncluded(addons: Partial<Record<AddonKey, number>> | null | undefined): { tier: CallAssistantTier | null; numbers: number; minutes: number } {
  const tier = callAssistantTierOf(addons);
  return { tier, numbers: tier?.includedNumbers ?? 0, minutes: tier?.includedMinutes ?? 0 };
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

/**
 * Subscription statuses under which an add-on MODULE runs (the AI Call
 * Assistant answers calls). Stricter than ACCESS_STATUSES on purpose — owner,
 * 2026-10-02: "As soon as they stop paying the agent stops working." The plan
 * itself keeps its features through Stripe's retries (past_due); the
 * assistant, which costs GPU, AI and carrier minutes per call, does not.
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
