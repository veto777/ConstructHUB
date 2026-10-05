/**
 * Search-engine facts for the public marketing pages, shared by the server
 * (the HTML head it sends, the sitemap), the build (the prerendered HTML, the
 * lastmod dates) and the browser (the head kept current as you navigate).
 *
 *   MARKETING_ROUTES   every page the build prerenders and the sitemap lists
 *   jsonLdForPath()    the page's structured data: Organization site-wide,
 *                      WebSite on the home page, a BreadcrumbList, an FAQPage
 *                      from the page's FAQ, and for a feature a
 *                      SoftwareApplication (a service: a Service) — with an
 *                      Offer only when the page shows a price, never for
 *                      "Talk to a sales rep", a coming-soon add-on or a feature
 *                      that is free with an account
 *   seoHeadFor()       canonical URL, title, description, image and JSON-LD
 *
 * Everything comes from the content registries and the price book — no typed
 * prices, no ratings, no reviews.
 */
import {
  EXTERNAL_FEATURE_PAGES, FEATURES_PATH, READY_FEATURE_PAGES, featurePageBySlug, featurePagePath,
} from "./feature-pages";
import { featurePriceSummary, type FeaturePriceSummary } from "./feature-pages/pricing";
import type { FeaturePricing } from "./feature-pages/types";
import { DFY_PATH, EXTERNAL_DFY_PAGES, READY_DFY_PAGES, dfyPageBySlug, dfyPagePath } from "./dfy-pages";
import { ROUTE_META } from "./route-meta";

/** The canonical origin: every page on every marketing domain names this one (server/site-context.ts PRIMARY_DOMAIN). */
export const SITE_ORIGIN = "https://constructhub.us";
export const SITE_NAME = "ConstructHUB";
export const SITE_EMAIL = "support@constructhub.us";
/** The link-preview image (client/public/og-image.png, 1200×630) unless a page has its own. */
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-image.png`;
const LOGO = `${SITE_ORIGIN}/chub-logo-square.png`;

const CALL_ASSISTANT_PATH = "/call-assistant";
const REINSTATEMENT_PATH = "/reinstatement";

/**
 * Every public marketing page, in sitemap order: prerendered at build time
 * (script/prerender.ts) and listed in the sitemap (server/static.ts). Feature
 * and service pages join once they are "ready". Paths are canonical: no
 * trailing slash, no query.
 */
export const MARKETING_ROUTES: readonly string[] = [
  "/",
  FEATURES_PATH,
  ...READY_FEATURE_PAGES.map(featurePagePath),
  CALL_ASSISTANT_PATH,
  DFY_PATH,
  ...READY_DFY_PAGES.map(dfyPagePath),
  REINSTATEMENT_PATH,
  "/pricing",
  "/google-business",
  "/google-ads-guide",
  "/google-ad-fraud",
  "/lsa-guide",
  "/privacy",
  "/terms",
  "/support",
];

/** The short name a breadcrumb uses for the pages that are not features or services. */
const PAGE_NAMES: Record<string, string> = {
  [FEATURES_PATH]: "Features",
  [DFY_PATH]: "Done-For-You Services",
  [CALL_ASSISTANT_PATH]: "AI Call Assistant",
  [REINSTATEMENT_PATH]: "GBP Reinstatement",
  "/pricing": "Pricing",
  "/google-business": "Google Business Profile",
  "/google-ads-guide": "Google Ads Guide",
  "/google-ad-fraud": "Google Ad Fraud",
  "/lsa-guide": "LSA Guide",
  "/privacy": "Privacy Policy",
  "/support": "Support",
  "/terms": "Terms of Use",
};

/**
 * The repo file whose last commit dates the page (the sitemap's <lastmod>,
 * computed at build time by script/build.ts): a feature's or a service's
 * content file, otherwise the page component.
 */
export function routeSourceFile(path: string): string | null {
  const feature = featureAt(path);
  if (feature) return `shared/feature-pages/${feature.key}.ts`;
  const dfy = dfyAt(path);
  if (dfy) return `shared/dfy-pages/${dfy.key}.ts`;
  const pages: Record<string, string> = {
    "/": "client/src/pages/landing.tsx",
    [FEATURES_PATH]: "client/src/pages/features.tsx",
    [CALL_ASSISTANT_PATH]: "client/src/pages/call-assistant-landing.tsx",
    [DFY_PATH]: "client/src/pages/done-for-you.tsx",
    [REINSTATEMENT_PATH]: "client/src/pages/reinstatement.tsx",
    "/pricing": "client/src/pages/pricing.tsx",
    "/google-business": "client/src/pages/google-business.tsx",
    "/google-ads-guide": "client/src/pages/google-ads-guide.tsx",
    "/google-ad-fraud": "client/src/pages/google-ad-fraud.tsx",
    "/lsa-guide": "client/src/pages/lsa-guide.tsx",
    "/privacy": "client/src/pages/privacy-policy.tsx",
    "/terms": "client/src/pages/terms-of-use.tsx",
    "/support": "client/src/pages/support.tsx",
    "/auth": "client/src/pages/auth.tsx",
  };
  return pages[path] ?? null;
}

const featureAt = (path: string) =>
  path.startsWith(`${FEATURES_PATH}/`) ? featurePageBySlug(path.slice(FEATURES_PATH.length + 1)) : undefined;
const dfyAt = (path: string) =>
  path.startsWith(`${DFY_PATH}/`) ? dfyPageBySlug(path.slice(DFY_PATH.length + 1)) : undefined;

/** https://constructhub.us<path> */
export const absoluteUrl = (path: string) => `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;

// ── JSON-LD builders ─────────────────────────────────────────────────────────

/** One schema.org node (the page's script holds them in an @graph). */
export type JsonLd = { "@type": string } & Record<string, unknown>;

const ORG_ID = `${SITE_ORIGIN}/#organization`;

export function organizationJsonLd(): JsonLd {
  return { "@type": "Organization", "@id": ORG_ID, name: SITE_NAME, url: `${SITE_ORIGIN}/`, logo: LOGO, email: SITE_EMAIL };
}

export function websiteJsonLd(): JsonLd {
  return { "@type": "WebSite", "@id": `${SITE_ORIGIN}/#website`, name: SITE_NAME, url: `${SITE_ORIGIN}/`, publisher: { "@id": ORG_ID } };
}

/** Home → … → the page. Null for fewer than two steps (the home page has no trail). */
export function breadcrumbJsonLd(trail: readonly { name: string; path: string }[]): JsonLd | null {
  if (trail.length < 2) return null;
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({ "@type": "ListItem", position: i + 1, name: step.name, item: absoluteUrl(step.path) })),
  };
}

/** The page's FAQ as an FAQPage; null when the page has none. */
export function faqPageJsonLd(faqs: readonly { q: string; a: string }[]): JsonLd | null {
  const items = faqs.filter((f) => f.q.trim() && f.a.trim());
  if (!items.length) return null;
  return {
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({ "@type": "Question", name: f.q.trim(), acceptedAnswer: { "@type": "Answer", text: f.a.trim() } })),
  };
}

/**
 * The Offer for a price the page shows (a monthly plan price, a one-time
 * service price), or null when it shows none: "Talk to a sales rep", a coming-soon add-on, a
 * feature that is free with an account.
 */
export function offerJsonLd(price: FeaturePriceSummary, url: string): JsonLd | null {
  if (!price.price || price.comingSoon) return null;
  const figure = /^\$([\d,]+(?:\.\d{2})?)$/.exec(price.price);
  if (!figure) return null;
  const amount = Number(figure[1].replace(/,/g, "")).toFixed(2);
  const monthly = price.per.trim() === "/mo";
  return {
    "@type": "Offer",
    url,
    price: amount,
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    description: price.priceNote,
    ...(monthly ? { priceSpecification: { "@type": "UnitPriceSpecification", price: amount, priceCurrency: "USD", unitText: "month" } } : {}),
  };
}

/** Sold as work people do (a one-time service, or quoted by a sales rep) rather than as software. */
const isService = (pricing: FeaturePricing) => pricing.kind === "service" || pricing.kind === "sales";

/**
 * A feature as a SoftwareApplication, or — when it is work our team does — a
 * Service, with its Offer when the page shows a price.
 */
export function offeringJsonLd(item: { title: string; lede: string; path: string; pricing: FeaturePricing }): JsonLd {
  const url = absoluteUrl(item.path);
  const offer = offerJsonLd(featurePriceSummary(item.pricing), url);
  const common = { name: item.title, description: item.lede, url, ...(offer ? { offers: offer } : {}) };
  return isService(item.pricing)
    ? { "@type": "Service", ...common, provider: { "@id": ORG_ID } }
    : { "@type": "SoftwareApplication", ...common, applicationCategory: "BusinessApplication", operatingSystem: "Web", publisher: { "@id": ORG_ID } };
}

/** The breadcrumb trail for a marketing page. */
export function breadcrumbTrail(path: string): { name: string; path: string }[] {
  const home = { name: "Home", path: "/" };
  if (path === "/") return [home];
  const feature = featureAt(path);
  if (feature) return [home, { name: PAGE_NAMES[FEATURES_PATH], path: FEATURES_PATH }, { name: feature.title, path }];
  const dfy = dfyAt(path);
  if (dfy) return [home, { name: PAGE_NAMES[DFY_PATH], path: DFY_PATH }, { name: dfy.title, path }];
  if (path === CALL_ASSISTANT_PATH) return [home, { name: PAGE_NAMES[FEATURES_PATH], path: FEATURES_PATH }, { name: PAGE_NAMES[path], path }];
  if (path === REINSTATEMENT_PATH) return [home, { name: PAGE_NAMES[DFY_PATH], path: DFY_PATH }, { name: PAGE_NAMES[path], path }];
  const name = PAGE_NAMES[path] ?? ROUTE_META[path]?.title.replace(/\s*\|\s*ConstructHUB$/, "");
  return name ? [home, { name, path }] : [home];
}

/**
 * The page's structured data, in @graph order. `extra` adds nodes the build
 * reads off the rendered page (the /call-assistant FAQ, which lives in that
 * page's component). Empty for a path that is not a marketing page.
 */
export function jsonLdForPath(path: string, extra: readonly JsonLd[] = []): JsonLd[] {
  if (!ROUTE_META[path]) return [];
  const graph: (JsonLd | null)[] = [organizationJsonLd()];
  if (path === "/") graph.push(websiteJsonLd());
  graph.push(breadcrumbJsonLd(breadcrumbTrail(path)));
  const feature = featureAt(path);
  const dfy = dfyAt(path);
  if (feature) {
    graph.push(offeringJsonLd({ title: feature.title, lede: feature.lede, path, pricing: feature.pricing }));
    graph.push(faqPageJsonLd(feature.faqs));
  } else if (dfy) {
    graph.push(offeringJsonLd({ title: dfy.title, lede: dfy.lede, path, pricing: dfy.pricing }));
    graph.push(faqPageJsonLd(dfy.faqs));
  } else {
    // A hand-built page that is listed in a catalogue (/call-assistant, /reinstatement).
    const listed = [...EXTERNAL_FEATURE_PAGES, ...EXTERNAL_DFY_PAGES].find((e) => e.path === path);
    if (listed) graph.push(offeringJsonLd(listed));
  }
  graph.push(...extra);
  return graph.filter((node): node is JsonLd => node !== null);
}

/** The JSON-LD script's text: one @graph, safe inside <script> (no "</" can close it). */
export function serializeJsonLd(graph: readonly JsonLd[]): string {
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}

export type SeoHead = {
  canonical: string;
  title: string;
  description: string;
  image: string;
  jsonLd: JsonLd[];
};

/** Everything the <head> says about a marketing page; null for any other path. */
export function seoHeadFor(path: string, extra: readonly JsonLd[] = []): SeoHead | null {
  const meta = ROUTE_META[path];
  if (!meta) return null;
  return {
    canonical: absoluteUrl(path),
    title: meta.title,
    description: meta.description,
    image: DEFAULT_OG_IMAGE,
    jsonLd: jsonLdForPath(path, extra),
  };
}

/** A request path as its canonical form: no query or hash, no trailing slash (except the root). */
export function canonicalPath(reqPath: string): string {
  let p = (reqPath || "/").split(/[?#]/)[0];
  if (p.length > 1 && p.endsWith("/")) p = p.replace(/\/+$/, "");
  if (!p.startsWith("/") || p.includes("..")) p = "/";
  return p || "/";
}
