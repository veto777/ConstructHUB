/**
 * À la carte — every tool as a stand-alone monthly or annual subscription
 * (owner order 2026-10-10: "Every single tool should be a stand alone service
 * that someone can buy per month … This page can also have an add-on page that
 * when someone has a package they can upgrade for a small discount").
 *
 * This file is the ONE place the à la carte prices live (docs/pricing/README.md
 * → "À la carte"). The checkout (server/billing/alacarte.ts), the entitlements
 * (server/entitlements.ts), the pricing tab (client/src/components/alacarte-cards.tsx)
 * and the feature landing pages all read it; nothing types a price twice.
 *
 *   - Two prices per item, in cents a month: STANDALONE for an account with no
 *     paid plan, ADD-ON ("a small discount") for an account with an active paid
 *     Business Tools plan (shared/plans.ts) or CRM plan (shared/crm-plans.ts).
 *     alacarteTierFor() decides from the account's active plans; the price in
 *     force is re-read at every renewal, never mid-cycle (server/billing/alacarte.ts).
 *   - Annual = ALACARTE_ANNUAL_MONTHS × monthly (one month free), the platform rule.
 *   - An item that overlaps an existing platform add-on (the SEO suite, the
 *     protected website) names it in `existingAddon`: its add-on tier IS that
 *     add-on's price and its grants are that add-on's grants, so there is never
 *     a parallel product with a second price for the same thing.
 *   - `grants` is what an active item adds to the account's allowances and
 *     modules, with or without a plan (server/entitlements.ts applyAlacarteGrants).
 *     Existing per-plan allowances stay; an item only ever adds.
 *   - The AI Call Assistant and the CRM are ALREADY sold on their own
 *     subscriptions: the tab links their cards (ALACARTE_LINKED) and never
 *     duplicates their checkout. The client texting number is an add-on only
 *     (ADDONS.texting_number), listed as such (ALACARTE_ADDON_ONLY).
 *   - JobCam: the CRM's JobCam (CRM_ADDONS.jobcam) sold here. On a CRM plan that
 *     sells the add-on it IS that add-on; with no CRM plan at all (owner,
 *     2026-10-10: "all features should have a standalone access") the purchase
 *     grants a JobCam-only CRM shell — the owner's org, JobCam, clients and
 *     projects to file shots to, the included storage — while the rest of the
 *     CRM stays locked behind a CRM plan (server/crm/entitlements.ts jobcamOnly,
 *     server/crm/tenancy.ts JOBCAM_SHELL_PATHS).
 *
 * Money is in cents.
 */
import {
  ADDONS, ANNUAL_MONTHS, CALL_ASSISTANT_FROM_CENTS, CALL_ASSISTANT_NAME, CALL_ASSISTANT_PRICING_HREF, COMING_MODULES,
  NO_PLAN_MODULES, UNLIMITED, MODULE_NAMES,
  type AddonKey, type BillingInterval, type CountLimitKey, type ModuleKey, type PlanKey, type PlanLimits, type PlanModules,
} from "./plans";
import { CRM_ADDONS, CRM_PLANS, CRM_PLAN_KEYS, type CrmPlanKey } from "./crm-plans";

export type AlacarteKey =
  | "gbp" | "reviews" | "gridrank" | "competitor_intel" | "site_scan" | "ai_posts" | "ads_manager" | "click_guard"
  | "seo_basic" | "seo_pro" | "website_tools" | "social" | "permits" | "jobcam" | "master_class";

/** Display order on the tab. */
export const ALACARTE_KEYS: readonly AlacarteKey[] = [
  "gbp", "reviews", "gridrank", "competitor_intel", "site_scan", "ai_posts", "ads_manager", "click_guard",
  "seo_basic", "seo_pro", "website_tools", "social", "permits", "jobcam", "master_class",
];

/** The price an account pays: no paid plan = standalone; an active Business Tools or CRM plan = add-on. */
export type AlacarteTier = "standalone" | "addon";
export const ALACARTE_TIERS: readonly AlacarteTier[] = ["standalone", "addon"];

/** Annual billing: this many months of the monthly price (one month free) — the platform rule. */
export const ALACARTE_ANNUAL_MONTHS = ANNUAL_MONTHS;

/** The most units of a per-location / per-website item one order may hold; more is a sales conversation. */
export const ALACARTE_MAX_QUANTITY = 25;

/** Where the tab lives on /pricing. */
export const ALACARTE_PRICING_HREF = "/pricing#alacarte";

/** `code` on the 402 a route answers when the account has neither a plan nor the item (server/entitlements.ts). */
export const ALACARTE_REQUIRED_CODE = "alacarte_required";

/** What one active item adds to the account (per unit for items with a `unit`). */
export type AlacarteGrants = {
  /** Modules switched on (shared/plans.ts PlanModules). */
  modules?: readonly ModuleKey[];
  /** Count limits added per unit; UNLIMITED (-1) makes the limit unlimited (fair use). */
  limits?: Partial<Record<CountLimitKey, number>>;
  /** AI review replies may publish without a human approving each one. */
  autoPublishAiReplies?: boolean;
  /** JobCam on the CRM (shared/crm-plans.ts CRM_ADDONS.jobcam): the add-on on a CRM plan, or the JobCam-only shell without one. */
  crmJobcam?: boolean;
};

export type AlacarteItem = {
  key: AlacarteKey;
  name: string;
  /** One plain line under the name: what it does. Every claim traceable to the feature page it links. */
  pitch: string;
  /** A month at the standalone price (no paid plan). */
  standaloneMonthlyCents: number;
  /**
   * A month at the add-on price (an active paid plan). For an item with
   * `existingAddon` this is that add-on's price (ADDONS[existingAddon]) —
   * read it through alacartePriceCents(), never from here.
   */
  addonMonthlyCents: number;
  grants: AlacarteGrants;
  /** The feature page (/features/<slug>): the card's "Compare" link and the landing page a locked tool opens. */
  slug: string;
  /** Overlaps a platform add-on: the add-on tier reuses its key, price and grants (never a parallel product). */
  existingAddon?: AddonKey;
  /** "location" / "website": the item is per unit; a quantity of units can be bought (ALACARTE_MAX_QUANTITY). */
  unit?: string;
  /** A part of the item that is promised but still being built (its module sits in COMING_MODULES). */
  comingPart?: string;
  /** One of these per account (the two SEO suites). */
  exclusiveGroup?: "seo";
};

/**
 * What a stand-alone account (no plan) starts from before its à la carte items
 * are applied: nothing, except the rates that are not usage caps (the slowest
 * Profile Guard cadence, the API's per-minute rate) and the keep-history default.
 */
export const STANDALONE_BASE_LIMITS: PlanLimits = {
  locations: 0, clientWorkspaces: 0, textingNumbersIncluded: 0, historyDays: 90, gabeQuestions: 0, guardCadenceMinutes: 60,
  gridCredits: 0, gridCreditsPerLocation: 0, competitorScans: 0, protectedSites: 0, siteScans: 0, siteScansPerLocation: 0,
  permitSearches: 0, agencySeats: 1, teamTextSegments: 0, clientTexting: "none", autoPublishAiReplies: false, reviewTemplates: 0,
  apiUnitsPerMonth: 0, apiRatePerMinute: 60, seoKeywords: 0, seoCreditCents: 0,
};

const item = (
  key: AlacarteKey, name: string, pitch: string, standaloneMonthlyCents: number, addonMonthlyCents: number,
  grants: AlacarteGrants, slug: string, extra: Partial<Omit<AlacarteItem, "key" | "name" | "pitch" | "standaloneMonthlyCents" | "addonMonthlyCents" | "grants" | "slug">> = {},
): AlacarteItem => ({ key, name, pitch, standaloneMonthlyCents, addonMonthlyCents, grants, slug, ...extra });

// ── The price book (owner-steered proposal v2, 2026-10-10) ───────────────────
export const ALACARTE: Record<AlacarteKey, AlacarteItem> = {
  gbp: item("gbp", "Google Business Profile + Profile Guard",
    "One Google listing, synced and watched: every unapproved edit is caught hourly and can be locked back to the value you approved.",
    3900, 2400, { limits: { locations: 1, reviewTemplates: 5 } }, "gbp", { unit: "location" }),
  reviews: item("reviews", "Google Reviews",
    "Review alerts, AI reply drafts in your own words that publish automatically when you allow it, review reminders to customers and 20 reply templates.",
    5900, 3900, { modules: ["reviewReminders"], autoPublishAiReplies: true, limits: { reviewTemplates: 20 } }, "reviews"),
  gridrank: item("gridrank", "GridRank",
    "Where your business ranks on the map, point by point, with who outranks you at each one: 10 ranking-grid credits a month and scheduled grid watches.",
    4900, 2900, { modules: ["gridWatches"], limits: { gridCredits: 10 } }, "ranking-grid"),
  competitor_intel: item("competitor_intel", "Competitor Intel",
    "Scan an area by trade to see who ranks, what their listings and reviews look like, and where they are weak: 5 scans a month.",
    2900, 1900, { limits: { competitorScans: 5 } }, "competitors"),
  site_scan: item("site_scan", "Site Scan",
    "Your website checked against your Google profile with fix steps per site builder and a branded PDF: 5 scans a month.",
    2900, 1900, { limits: { siteScans: 5 } }, "site-scan"),
  ai_posts: item("ai_posts", "AI Google posts",
    "Posts and photo captions drafted from your listing's own facts and published on a schedule, in business hours, never twice.",
    3900, 2400, { modules: ["autoPosts"] }, "gbp-content"),
  ads_manager: item("ads_manager", "Google Ads & LSA manager",
    "Manager-account access requests, health audits, protections previewed before they are written, Click Guard IPs pushed into Ads exclusions.",
    12900, 7900, { modules: ["adsManager"] }, "ads-manager"),
  // The protected website overlaps ADDONS.protected_site: the add-on tier is that add-on (its price, its grant).
  click_guard: item("click_guard", "IP Tracker + Click Guard + VPN Shield",
    "Every visitor's IP logged, click fraud blocked in your own Google Ads account, VPN traffic blocked, logged or redirected: one website per unit.",
    6900, ADDONS.protected_site.monthlyCents, { limits: { ...ADDONS.protected_site.grants } }, "click-guard",
    { existingAddon: "protected_site", unit: "website" }),
  // The SEO suites overlap ADDONS.seo_basic / seo_pro: the add-on tier is that add-on; one suite per account.
  seo_basic: item("seo_basic", ADDONS.seo_basic.name,
    "Site explorer, rank tracker, keyword research and backlinks: 1,000 tracked keywords and a monthly SEO data allowance.",
    5900, ADDONS.seo_basic.monthlyCents, { limits: { ...ADDONS.seo_basic.grants } }, "seo",
    { existingAddon: "seo_basic", exclusiveGroup: "seo" }),
  seo_pro: item("seo_pro", ADDONS.seo_pro.name,
    "The full suite: 5,000 tracked keywords and a larger monthly SEO data allowance.",
    12900, ADDONS.seo_pro.monthlyCents, { limits: { ...ADDONS.seo_pro.grants } }, "seo",
    { existingAddon: "seo_pro", exclusiveGroup: "seo" }),
  website_tools: item("website_tools", "Website Tools",
    "Cloudflare rules and Search Console in one place, DNS at your registrar with preview and rollback, and provider alert emails sorted by severity.",
    5900, 3900, { modules: ["cloudflareSearchConsole", "domainsMailAlerts"] }, "cloudflare"),
  social: item("social", "Social media publishing",
    "Posts written only from real material — offers, Google updates, reviews — on a daily AI budget with quiet hours, across every business you manage.",
    4900, 2900, { modules: ["socialPublishing"] }, "social"),
  permits: item("permits", "Permits search + alerts",
    "Live search of the real permit portals by address, name, company, license or permit number, unlimited, plus alerts for new filings.",
    19900, 12900, { modules: ["permitAlerts"], limits: { permitSearches: UNLIMITED } }, "permits",
    { comingPart: COMING_MODULES.includes("permitAlerts") ? MODULE_NAMES.permitAlerts : undefined }),
  jobcam: item("jobcam", CRM_ADDONS.jobcam.name,
    "Job-site photos and video filed to each project and client, with a per-shot client switch and share links you can password, expire and revoke.",
    5900, CRM_ADDONS.jobcam.monthlyCents, { crmJobcam: true }, "jobcam"),
  master_class: item("master_class", MODULE_NAMES.masterClass,
    "The contractor course: website, SEO, Google Business Profile and Google Ads, with licensing guides for all 50 states.",
    9900, 4900, { modules: ["masterClass"] }, "master-class"),
};

/** The CRM and the AI Call Assistant: already stand-alone, bought on their own cards — linked from the tab, never duplicated. */
export const ALACARTE_LINKED: readonly { key: "crm" | "call_assistant"; name: string; pitch: string; fromMonthlyCents: number; href: string; slug: string }[] = [
  {
    key: "crm", name: "ConstructHUB CRM",
    pitch: "Estimates, invoices, payments, scheduling and a client portal — its own plans and its own subscription.",
    fromMonthlyCents: Math.min(...CRM_PLAN_KEYS.map((k) => CRM_PLANS[k].monthlyCents)), href: "/pricing#crm", slug: "crm",
  },
  {
    key: "call_assistant", name: CALL_ASSISTANT_NAME,
    pitch: "An AI receptionist on a local number: answers 24/7, screens spam and files every real caller as a lead — its own tiers and subscription.",
    fromMonthlyCents: CALL_ASSISTANT_FROM_CENTS, href: CALL_ASSISTANT_PRICING_HREF, slug: "call-assistant",
  },
];

/** Add-on only: never stand-alone (a texting number needs a plan's text allowance to send with). */
export const ALACARTE_ADDON_ONLY: readonly { addon: AddonKey; name: string; pitch: string; slug: string }[] = [
  { addon: "texting_number", name: ADDONS.texting_number.name, pitch: ADDONS.texting_number.description, slug: "texting" },
];

export const isAlacarteKey = (value: unknown): value is AlacarteKey =>
  typeof value === "string" && (ALACARTE_KEYS as readonly string[]).includes(value);
export const isAlacarteTier = (value: unknown): value is AlacarteTier => value === "standalone" || value === "addon";

/** A month of an item at a tier: the item's own price, or the overlapping add-on's for its add-on tier. */
export function alacarteMonthlyCents(key: AlacarteKey, tier: AlacarteTier): number {
  const it = ALACARTE[key];
  if (tier === "standalone") return it.standaloneMonthlyCents;
  return it.existingAddon ? ADDONS[it.existingAddon].monthlyCents : it.addonMonthlyCents;
}

/** The price for an interval: annual is ALACARTE_ANNUAL_MONTHS × monthly (an overlapping add-on's own annual price). */
export function alacartePriceCents(key: AlacarteKey, tier: AlacarteTier, interval: BillingInterval): number {
  const it = ALACARTE[key];
  if (interval === "month") return alacarteMonthlyCents(key, tier);
  if (tier === "addon" && it.existingAddon) return ADDONS[it.existingAddon].annualCents;
  return alacarteMonthlyCents(key, tier) * ALACARTE_ANNUAL_MONTHS;
}

/** What yearly billing saves against twelve monthly payments. */
export const alacarteAnnualSavingsCents = (key: AlacarteKey, tier: AlacarteTier) =>
  alacarteMonthlyCents(key, tier) * 12 - alacartePriceCents(key, tier, "year");

/** The active plans an account holds — what decides its tier. Both null = no paid plan. */
export type AlacarteAccount = { plan: PlanKey | null | undefined; crmPlan: CrmPlanKey | null | undefined };

/** Does the account pay the add-on price? Any active paid Business Tools plan or CRM plan. */
export const isAddonPrice = (account: AlacarteAccount): boolean => !!account.plan || !!account.crmPlan;
export const alacarteTierFor = (account: AlacarteAccount): AlacarteTier => (isAddonPrice(account) ? "addon" : "standalone");

/** One active item as the entitlements read it. */
export type AlacarteHolding = { key: AlacarteKey; quantity: number };

/**
 * The allowances and modules an account has once its active items are laid
 * over `base` (a plan's allowances, or STANDALONE_BASE_LIMITS without one).
 * Only ever raises: unlimited stays unlimited, a module never turns off. Pure.
 */
export function applyAlacarteGrants(base: PlanLimits, modules: PlanModules, holdings: readonly AlacarteHolding[]): { limits: PlanLimits; modules: PlanModules } {
  const limits: PlanLimits = { ...base };
  const out: PlanModules = { ...modules };
  for (const h of holdings) {
    if (!isAlacarteKey(h.key)) continue;
    const g = ALACARTE[h.key].grants;
    const qty = Math.max(1, Math.floor(h.quantity) || 1);
    for (const m of g.modules ?? []) out[m] = true;
    if (g.autoPublishAiReplies) limits.autoPublishAiReplies = true;
    for (const [limit, per] of Object.entries(g.limits ?? {}) as [CountLimitKey, number][]) {
      if (limits[limit] === UNLIMITED) continue;
      limits[limit] = per === UNLIMITED ? UNLIMITED : limits[limit] + per * qty;
    }
  }
  return { limits, modules: out };
}

/** The modules an item switches on, by name — for the card and the 402. */
export const alacarteModuleNames = (key: AlacarteKey): string[] => (ALACARTE[key].grants.modules ?? []).map((m) => MODULE_NAMES[m]);

/** The cheapest item that unlocks a module, for an upgrade prompt; null when none sells it. */
export function alacarteItemForModule(module: ModuleKey): AlacarteKey | null {
  const sellers = ALACARTE_KEYS.filter((k) => ALACARTE[k].grants.modules?.includes(module));
  return sellers.sort((a, b) => ALACARTE[a].standaloneMonthlyCents - ALACARTE[b].standaloneMonthlyCents)[0] ?? null;
}

/** The items whose feature page is this slug (the SEO page sells two). */
export const alacarteItemsForSlug = (slug: string): AlacarteItem[] => ALACARTE_KEYS.map((k) => ALACARTE[k]).filter((it) => it.slug === slug);

/**
 * What the account already has of an item, so the checkout never sells what the
 * plan (or a held add-on) already gives: every module on and nothing countable
 * to add, an unlimited count, the overlapping add-on held, or the item itself.
 */
export function alacarteAlreadyCovered(
  key: AlacarteKey,
  have: { modules: PlanModules; allowances: PlanLimits | null; addons: Partial<Record<AddonKey, number>>; alacarte: readonly AlacarteKey[] },
): boolean {
  const it = ALACARTE[key];
  if (have.alacarte.includes(key)) return true;
  if (it.existingAddon && (have.addons[it.existingAddon] ?? 0) > 0) return true;
  if (it.exclusiveGroup && ALACARTE_KEYS.some((k) => k !== key && ALACARTE[k].exclusiveGroup === it.exclusiveGroup && have.alacarte.includes(k))) return true;
  const g = it.grants;
  if (g.crmJobcam) return false;
  const counts = Object.entries(g.limits ?? {}) as [CountLimitKey, number][];
  const modulesOn = (g.modules ?? []).every((m) => have.modules[m]);
  const publishOn = !g.autoPublishAiReplies || !!have.allowances?.autoPublishAiReplies;
  // An item sold for its modules (reviews, GridRank, permits) is covered once the plan has them; its count is a bonus.
  if (!counts.length || g.modules?.length || g.autoPublishAiReplies) return modulesOn && publishOn;
  // A countable item adds to the plan's number; only an unlimited number leaves nothing to add.
  return counts.every(([limit]) => have.allowances?.[limit] === UNLIMITED);
}

/** NO_PLAN_MODULES, re-exported so a reader of this file needs nothing else for a stand-alone account. */
export const STANDALONE_BASE_MODULES: PlanModules = NO_PLAN_MODULES;
