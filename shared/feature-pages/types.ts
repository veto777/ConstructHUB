/**
 * The content of one feature's intro page (/features/<slug>), as data. The
 * page itself is one template (client/src/components/feature-landing/**) in the
 * /call-assistant page's editorial look, so every feature reads the same way
 * and a writer only ever edits a content file — never markup.
 *
 * Rules for every field: shared/feature-pages/WRITING-GUIDE.md. In short:
 * every claim traceable to code, no typed prices (pricing is a spec the
 * template prices from the price book), no stats, no testimonials, no sample
 * customer data.
 */
import type { AddonKey, CountLimitKey, ModuleKey } from "../plans";
import type { CrmAddonKey } from "../crm-plans";
import type { DashboardGroupKey, DashboardSurface } from "../dashboard";

/** The dashboard's five groups, plus the platform pieces that have no tile (Gabe, the API). */
export type FeatureGroupKey = DashboardGroupKey | "platform";

/**
 * Icons a content file may name. The client maps each to a lucide icon
 * (client/src/components/feature-landing/icons.ts); content stays plain data.
 */
export const FEATURE_ICONS = [
  "alert", "bell", "book", "bot", "building", "calendar", "camera", "chart", "check", "clipboard", "clock", "cloud",
  "code", "database", "download", "eye", "file", "filter", "fingerprint", "folder", "gauge", "globe", "graduation",
  "grid", "hard-hat", "history", "image", "inbox", "kanban", "key", "layers", "link", "list", "lock", "mail", "map",
  "map-pin", "megaphone", "message", "phone", "receipt", "refresh", "search", "send", "settings", "share", "shield",
  "shield-alert", "shield-check", "shield-off", "sparkles", "star", "tag", "target", "trending-up", "users", "wallet",
  "wrench", "zap",
] as const;
export type FeatureIcon = (typeof FEATURE_ICONS)[number];

/**
 * A plan allowance the price block lists plan by plan, read from
 * PLANS[plan].limits. `perLocation` is the Agency-style per-billed-location
 * allowance used when the flat one is 0 (siteScansPerLocation, …).
 */
export type FeatureAllowance = {
  /**
   * A platform plan limit, or "crmPlanSeats" for the CRM product's seats
   * (the CRM is sold separately — shared/crm-plans.ts).
   */
  limit: CountLimitKey | "crmPlanSeats";
  perLocation?: CountLimitKey;
  /** What one unit is, plural: "Site Scans", "websites", "team alert texts". */
  unit: string;
  /** "month" = a monthly allowance; "count" = a standing number (locations, sites, seats). */
  period: "month" | "count";
};

/**
 * How the feature is sold. NEVER a typed price: the template computes the
 * headline, the price and the plan-by-plan rows from shared/plans.ts through
 * shared/feature-pages/pricing.ts. Pick the kind that matches the code's gate
 * (requirePlan / reserveQuotaFor / requireModule / the add-on), not the copy.
 */
export type FeaturePricing = (
  /** Any active plan (requirePlan with no test): "Included in every plan", from the cheapest plan's price. */
  | { kind: "plan"; allowance?: FeatureAllowance }
  /** Plans whose allowance is not 0 (e.g. protectedSites): "Included from the <cheapest> plan". */
  | { kind: "allowance"; allowance: FeatureAllowance }
  /** A plan module (requireModule): the plan(s) whose `modules[module]` is true. */
  | { kind: "module"; module: ModuleKey; allowance?: FeatureAllowance }
  /** An add-on bought on top of a plan (ADDONS[addon]); `preview` add-ons show "Coming soon". */
  | { kind: "addon"; addon: AddonKey }
  /**
   * A CRM feature sold on the CRM subscription (shared/crm-plans.ts CRM_ADDONS): included in the CRM plan(s)
   * whose limits carry it, an add-on on the others. Priced from the CRM price book, never a platform plan.
   */
  | { kind: "crmAddon"; addon: CrmAddonKey }
  /** No plan check in the code: any signed-in account can use it. */
  | { kind: "account" }
  /** A one-time service with its price in the price book. */
  | { kind: "service"; service: "gbpReinstatement" }
  /** Quoted by a sales rep (anything at or above the sales threshold). */
  | { kind: "sales"; topic: string }
) & {
  /** One extra plain sentence under the price (no $ amounts — the test rejects them). */
  note?: string;
};

/** A section heading: `title` then an orange italic `em` part, as on /call-assistant ("Live in Four <em>Steps</em>"). */
export type FeatureHeading = { title: string; em?: string; intro?: string };

/**
 * The long-form "In Depth" band near the end of a page: its own section, with
 * a heading, 2–5 paragraphs and an optional bullet list, written to explain
 * the feature in the words a contractor searches with (WRITING-GUIDE.md →
 * "The In Depth section"). Same rules as every field: plain text, every claim
 * traceable to code, no $ amounts, no stats.
 */
export type FeatureInDepth = {
  /** The H2: `title` + the orange italic `em`, e.g. "Site Scan " + "in Depth". */
  heading: FeatureHeading;
  /** 2–5 paragraphs, 250–500 words with the bullets. */
  paragraphs: string[];
  /** Optional lead-in line above the bullets ("What the scan checks:"). */
  bulletsIntro?: string;
  /** Optional bullet list after the paragraphs. */
  bullets?: string[];
};

/**
 * What every template page says — a feature (/features/<slug>) or a
 * done-for-you service (/done-for-you/<slug>, shared/dfy-pages): the hero and
 * the sections the template renders. The two page kinds add how they are
 * sold and where they lead (FeaturePage, DfyPage).
 */
export type LandingContent = {
  /** Registry key: the dashboard tile key where there is one (shared/dashboard.ts). */
  key: string;
  /** URL segment: /features/<slug> or /done-for-you/<slug>. Kebab-case; never changes once published. */
  slug: string;
  /**
   * "stub": the placeholder the template branch created — title, lede and the
   * in-app route only. "ready": written to WRITING-GUIDE.md and checked. Only
   * ready pages are in the sitemap and prerendered, and a retired landing page
   * (`legacyPath`) redirects here only once its page is ready.
   */
  status: "stub" | "ready";
  /** The feature's name as the app's sidebar / page calls it (a service: as /pricing calls it). */
  title: string;
  /** The name in Title Case for the closing headline, when `title` is sentence case. */
  ctaTitle?: string;
  /** The hero's small-caps kicker, e.g. "Website audit". */
  kicker: string;
  /** The H1: `lead` + the marker-swiped `swipe` phrase + optional `tail`. */
  headline: { lead: string; swipe: string; tail?: string };
  /** One or two plain sentences under the H1: what it does, for whom. */
  lede: string;
  /** The navy panel: which mascot, and the line in his speech bubble. */
  hero: { mascot: "standing" | "gabe"; bubble: string };
  /** 3–5 steps from sign-up to the first result. Empty on a stub. */
  steps: { title: string; body: string }[];
  /** What you get: one card per capability the code really has. */
  cards: { icon: FeatureIcon; title: string; body: string }[];
  /**
   * Optional deep-dive in the /call-assistant "Calls & CRM" layout: a checklist
   * on the left, a navy panel of FIELD NAMES (never sample data) on the right.
   */
  spotlight?: {
    kicker: string;
    heading: FeatureHeading;
    points: string[];
    panel: { label: string; title: string; items: string[]; note?: string };
  };
  /** Who it is for: 2–4 short profiles. */
  audience: { title: string; body: string }[];
  /** 3–5 honest questions a buyer asks: what it needs from me, which plan, what it does NOT do. */
  faqs: { q: string; a: string }[];
  /** Optional long-form explanation, its own band near the end of the page (FeatureInDepth). */
  inDepth?: FeatureInDepth;
  /** Overrides for the section headings (defaults live in the template). */
  headings?: Partial<Record<"steps" | "cards" | "audience" | "pricing" | "faq" | "related", FeatureHeading>>;
  /** <title> and meta description (search results, link previews). */
  seo: { title: string; description: string };
  /** Repo paths that back the claims on the page — where a reviewer checks them. */
  sources: string[];
};

export type FeaturePage = LandingContent & {
  group: FeatureGroupKey;
  pricing: FeaturePricing;
  /** Registry keys of related features (shown as cards). */
  related: string[];
  /** The feature in the app: the "Open <feature>" button for signed-in visitors. */
  app: { href: string; surface: DashboardSurface; label?: string };
  /** A no-account way to try it (e.g. the free site scan), shown beside the sign-up button. */
  tryIt?: { label: string; href: string };
  /** A retired marketing page this one replaces (client-side redirect once `status` is "ready"). */
  legacyPath?: string;
  /** Client feature flag that hides the page entirely (client/src/lib/features.ts). */
  flag?: "SHOW_GOOGLE_REVIEWS" | "SHOW_COMPETITOR_INTEL";
};

/**
 * A catalogue entry whose page is NOT the template: the hand-built
 * /call-assistant page. Listed on /features and the admin index only.
 */
export type ExternalFeaturePage = {
  key: string;
  group: FeatureGroupKey;
  title: string;
  lede: string;
  /** Its own marketing page. */
  path: string;
  app: { href: string; surface: DashboardSurface };
  /** How it is sold (the catalogue card's price line). */
  pricing: FeaturePricing;
};
