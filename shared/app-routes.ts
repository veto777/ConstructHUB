/**
 * Every path the app answers on the main site (client/src/App.tsx), so the
 * server can send an honest 404 for any other URL instead of a 200 page that
 * looks like the home page to a search engine (a "soft 404"). The app still
 * renders its own Not Found page on top of the 404 response.
 *
 * Patterns: ":name" matches one path segment, a trailing "/*" matches anything
 * below that path. The vitest (server/marketing-seo.test.ts) reads every
 * `path="…"` in App.tsx and fails if one is missing here, so a new route can't
 * quietly start answering 404.
 */
import { MARKETING_ROUTES } from "./seo";
import { EXTERNAL_FEATURE_PAGES, FEATURE_PAGES, FEATURES_PATH, featurePagePath } from "./feature-pages";
import { DFY_PAGES, dfyPagePath } from "./dfy-pages";

export const APP_ROUTE_PATTERNS: readonly string[] = [
  // Signed-out and signed-in pages (PublicRouter, DashboardRouter).
  "/landing", "/auth", "/search", "/databases", "/property", "/schedules", "/history", "/photos", "/media-library",
  "/gmb-monitor", "/google-profile", "/ranking-grid", "/competitors", "/competitors-landing", "/agency", "/locations", "/domains",
  "/mail-alerts", "/gbp-content", "/social-media", "/guides", "/tutorials", "/cloudflare", "/search-console", "/seo", "/seo/rank-tracker", "/seo/local-grid", "/seo/plan", "/seo/audit", "/seo/alerts", "/seo/usage", "/seo/reports", "/seo/ai", "/seo/batch", "/seo/content", "/seo/explorer", "/seo/keywords", "/seo/backlinks", "/seo/competitors", "/site-scan",
  "/free-site-scan", "/site-scan/report/*", "/master-class", "/master-class-landing", "/google-ads", "/ads-manager",
  "/google-ads-landing", "/permits-landing", "/google-ads-guide/:section", "/lsa-leads", "/lsa-account-manager",
  "/ip-tracker", "/crm-app", "/admin", "/admin/feature-pages", "/admin/access", "/admin/issues", "/admin/youtube",
  "/vpn-shield", "/individual-pricing", "/google-reviews", "/settings", "/settings/billing", "/settings/api", "/account/delete",
  "/developers", "/crm-terms", "/crm-privacy", "/invite/:code", "/report-issue",
  // Pages a contractor's own customer opens from a link.
  "/review/:token", "/review/:token/unsubscribe", "/contract/sign/:token", "/e/:token", "/i/:token", "/co/:token",
  "/lead-form/:token", "/portal/:token",
  // JobCam share pages (gallery / timeline links; the portal host serves them, the main site must not 404 one).
  "/jc/:token",
  // The CRM's paths (the portal's own host serves them; the main site hands them over).
  "/crm", "/crm/*",
  // Google Ads landing doors (server/ads-landing.ts).
  "/googleads-features", "/googleads-crm",
];

function matches(pattern: string, path: string): boolean {
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2);
    return path.startsWith(`${base}/`) && path.length > base.length + 1;
  }
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return false;
  return want.every((seg, i) => (seg.startsWith(":") ? got[i].length > 0 : seg === got[i]));
}

/**
 * /features/<slug> and /done-for-you/<slug>: every page in the catalogues, written or not (a page still being
 * written renders too), and an external page's old slug (/features/call-assistant replaces itself with its page).
 */
const CATALOGUE_PATHS: ReadonlySet<string> = new Set([
  ...FEATURE_PAGES.map(featurePagePath),
  ...EXTERNAL_FEATURE_PAGES.map((e) => `${FEATURES_PATH}${e.path}`),
  ...DFY_PAGES.map(dfyPagePath),
]);

/** Does the app (or a prerendered marketing page) answer this canonical path? */
export function isKnownPath(path: string): boolean {
  return MARKETING_ROUTES.includes(path) || CATALOGUE_PATHS.has(path) || APP_ROUTE_PATTERNS.some((p) => matches(p, path));
}

/**
 * A marketing page asked for in the wrong case ("/FEATURES/GBP" → "/features/gbp"), or null.
 * Only marketing pages: a link's token (/review/<token>) is case-sensitive.
 */
export function marketingRouteForCase(path: string): string | null {
  if (MARKETING_ROUTES.includes(path)) return null;
  const lower = path.toLowerCase();
  return MARKETING_ROUTES.find((r) => r === lower) ?? null;
}
