/**
 * Browser-tab titles for the signed-in app and the CRM portal: every route has its own, so tabs, history and a
 * screen reader's page announcement can tell the pages apart (audit w3-r6: 71 sub-pages wore their tool's title and
 * every CRM page was "ConstructHub CRM"). The app's title is "<Page> · <Tool> · ConstructHUB" ("<Tool> ·
 * ConstructHUB" on a tool's first page); the CRM's is "<Page> · ConstructHub CRM".
 *
 * Public marketing pages keep the title the server writes into their HTML (shared/route-meta.ts pageMetaFor); App.tsx
 * applies that first. server/page-titles.test.ts checks every route App.tsx declares has a title here, a route-meta
 * entry, or a listed reason not to.
 *
 * Pure data (no React), so the static test can import it.
 */

export const APP_BRAND = "ConstructHUB";
export const CRM_BRAND = "ConstructHub CRM";

/** Growth-app routes (App.tsx DashboardRouter) → "<Page> · <Tool>", or the tool's name on its first page. */
export const APP_PAGE_TITLES: Readonly<Record<string, string>> = {
  "/search": "Search Permits",
  "/databases": "Database Directory",
  "/property": "Property Records",
  "/schedules": "Scrape Schedules",
  "/history": "Search History",
  "/permit-alerts": "Permit Alerts",
  "/photos": "Photo Optimizer",
  "/media-library": "Media Library",
  "/gmb-monitor": "GMB Edit Monitor",
  "/ranking-grid": "GMB Ranking Grid",
  "/pricing": "Pricing",
  "/competitors": "Competitor Intel",
  "/agency": "Agency",
  "/agency/clients": "Clients · Agency",
  "/agency/team": "Team · Agency",
  "/agency/onboarding": "Onboarding · Agency",
  "/agency/jobs": "Jobs · Agency",
  "/agency/settings": "Settings · Agency",
  "/locations": "Locations",
  "/google-profile": "Business Profile · Locations",
  "/invite/:code": "Invitation",
  "/domains": "Domains",
  "/mail-alerts": "Mail Alerts",
  "/gbp-content": "Posts · Posts & Photos",
  "/gbp-photos": "Photos · Posts & Photos",
  "/listing-editor": "Listing editor",
  "/directories": "Directory Sync",
  "/social-media": "Social Media",
  "/social-media/calendar": "Calendar · Social Media",
  "/social-media/compose": "New post · Social Media",
  "/social-media/posts": "Posts · Social Media",
  "/social-media/analytics": "Analytics · Social Media",
  "/social-media/inbox": "Inbox · Social Media",
  "/social-media/accounts": "Accounts · Social Media",
  "/social-media/auto": "Auto mode · Social Media",
  "/social-media/guides": "Guides · Social Media",
  "/guides": "Guides",
  "/tutorials": "Tutorials",
  "/cloudflare": "Cloudflare",
  "/cloudflare/connections": "Connections · Cloudflare",
  "/cloudflare/onboarding": "Onboarding · Cloudflare",
  "/cloudflare/work-queue": "Work queue · Cloudflare",
  "/cloudflare/edge-audit": "Edge audit · Cloudflare",
  "/cloudflare/guide": "Guide · Cloudflare",
  "/search-console": "Search Console",
  "/search-console/connections": "Connections · Search Console",
  "/search-console/onboarding": "Onboarding · Search Console",
  "/search-console/work-queue": "Work queue · Search Console",
  "/search-console/guide": "Guide · Search Console",
  "/site-scan": "Site Scan",
  "/site-scan/history": "Scan history · Site Scan",
  "/seo": "SEO Suite",
  "/seo/rank-tracker": "Rank tracker · SEO Suite",
  "/seo/explorer": "Site explorer · SEO Suite",
  "/seo/audit": "Site audit · SEO Suite",
  "/seo/alerts": "Alerts · SEO Suite",
  "/seo/mentions": "Mentions · SEO Suite",
  "/seo/usage": "Data usage · SEO Suite",
  "/seo/reports": "Reports · SEO Suite",
  "/seo/ai": "AI visibility · SEO Suite",
  "/seo/batch": "Batch analysis · SEO Suite",
  "/seo/local-grid": "Local grid · SEO Suite",
  "/seo/plan": "Action plan · SEO Suite",
  "/seo/content": "Content explorer · SEO Suite",
  "/seo/keywords": "Keywords explorer · SEO Suite",
  "/seo/backlinks": "Backlinks · SEO Suite",
  "/seo/competitors": "Competitor gap · SEO Suite",
  "/master-class": "Master Class",
  "/reinstatement": "Reinstatement",
  "/compliance": "Compliance Dept",
  "/compliance/research/coverage": "What a report searches · Compliance Dept",
  "/compliance/research": "Research reports · Compliance Dept",
  "/compliance/research/orders/:id": "Research report · Compliance Dept",
  "/press-releases": "Press Releases",
  "/google-business": "Google Business",
  "/google-ads": "Click Guard",
  "/google-ads/traffic": "Traffic sources · Click Guard",
  "/google-ads/signals": "Traffic signals · Click Guard",
  "/google-ads/tools": "Tools · Click Guard",
  "/google-ads/settings": "Domain settings · Click Guard",
  "/google-ads/script": "Google Ads script · Click Guard",
  "/ads-manager": "Agency Ads & LSA",
  "/ads-manager/accounts": "Client accounts · Agency Ads & LSA",
  "/ads-manager/invitations": "Access invitations · Agency Ads & LSA",
  "/ads-manager/previews": "Protection previews · Agency Ads & LSA",
  "/ads-manager/queue": "Queue · Agency Ads & LSA",
  "/ads-manager/audit": "Health audit · Agency Ads & LSA",
  "/ads-manager/landing-door": "Landing door · Agency Ads & LSA",
  "/google-ads-guide": "Google Ads Guide",
  "/google-ads-guide/:section": "Guide section · Google Ads Guide",
  "/google-ad-fraud": "Ad Fraud",
  "/lsa-guide": "LSA Guide",
  "/lsa-leads": "LSA Leads",
  "/ip-tracker": "IP Tracker",
  "/ip-tracker/visitors": "Visitors · IP Tracker",
  "/ip-tracker/traffic": "Traffic · IP Tracker",
  "/ip-tracker/pages": "Pages · IP Tracker",
  "/ip-tracker/geo": "Geo · IP Tracker",
  "/ip-tracker/platforms": "Platforms · IP Tracker",
  "/crm-app": "CRM",
  "/call-assistant": "AI Call Assistant",
  "/call-assistant/calls": "Calls · AI Call Assistant",
  "/call-assistant/numbers": "Numbers · AI Call Assistant",
  "/call-assistant/studio": "Agent studio · AI Call Assistant",
  "/call-assistant/simulator": "Simulator · AI Call Assistant",
  "/admin": "Platform admin",
  "/admin/feature-pages": "Feature pages · Admin",
  "/admin/access": "Access grants · Admin",
  "/admin/code-api": "Code API · Admin",
  "/admin/issues": "Issues · Admin",
  "/admin/backlinks": "Backlinks · Admin",
  "/admin/partnerships": "Partnerships · Admin",
  "/admin/press": "Press Wire desk · Admin",
  "/admin/directories": "Directory Sync · Admin",
  "/admin/tickets": "Support tickets · Admin",
  "/admin/tickets/:id": "Support ticket · Admin",
  "/admin/referrals": "Referrals · Admin",
  "/admin/youtube": "YouTube channel · Admin",
  "/report-issue": "Report an issue",
  "/vpn-shield": "VPN Shield",
  "/vpn-shield/flagged": "Flagged visits · VPN Shield",
  "/vpn-shield/install": "Install script · VPN Shield",
  "/vpn-shield/settings": "Settings · VPN Shield",
  "/google-reviews": "Google Reviews",
  "/google-reviews/reviews": "Reviews · Google Reviews",
  "/google-reviews/profiles": "Profiles & links · Google Reviews",
  "/google-reviews/settings": "Settings · Google Reviews",
  "/yelp": "Yelp",
  "/lsa-account-manager": "Account Manager",
  "/lsa-account-manager/accounts": "Accounts · Account Manager",
  "/lsa-account-manager/invitations": "Invitations · Account Manager",
  "/lsa-account-manager/audit": "Audit log · Account Manager",
  "/developers": "Developers",
  "/settings": "Settings",
  "/account/delete": "Delete account · Settings",
  "/auth": "Sign in",
};

/** CRM portal routes (App.tsx PortalRouter) → the page's name; the brand is added by crmPageTitle. */
export const CRM_PAGE_TITLES: Readonly<Record<string, string>> = {
  "/": "Home",
  "/crm": "Home",
  "/crm/home": "Home",
  "/crm/clients": "Clients",
  "/crm/clients/:id": "Client",
  "/crm/leads": "Leads",
  "/crm/schedule": "Schedule",
  "/crm/inbox": "Messages",
  "/crm/pipeline": "Pipeline",
  "/crm/estimates/new": "New estimate · Estimates",
  "/crm/estimates/:id": "Estimate · Estimates",
  "/crm/estimates": "Estimates",
  "/crm/invoices": "Invoices",
  "/crm/pricebook": "Price book",
  "/crm/projects/:id": "Project · Pipeline",
  "/crm/projects/:id/jobcam": "Project photos · JobCam",
  "/crm/jobcam": "JobCam",
  "/crm/payments": "Payments",
  "/crm/team": "Team & Company",
  "/crm/settings": "Settings",
  "/account/delete": "Delete account",
  "/crm/integrations": "Integrations",
  "/crm/reports": "Reports",
  "/crm/photos": "Photos",
  "/crm/migrate": "Import",
  "/crm/admin": "Platform admin",
  "/admin": "Platform admin",
  "/crm/join": "Join the team",
  "/crm/report-issue": "Report an issue",
  "/auth": "Sign in",
};

/** A route pattern ("/admin/tickets/:id") as an anchored regex. */
const patternRe = (pattern: string) =>
  new RegExp(`^${pattern.split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/")}$`);

/**
 * The title entry for a path: the exact route, else a route pattern that matches it (":id"), else the longest route
 * prefix (a deeper link under a tool keeps that tool's page title). Query and hash are ignored.
 */
export function titleEntryFor(map: Readonly<Record<string, string>>, pathname: string): string | undefined {
  const path = pathname.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  if (map[path]) return map[path];
  const keys = Object.keys(map);
  const pattern = keys.filter((k) => k.includes("/:")).sort((a, b) => b.length - a.length).find((k) => patternRe(k).test(path));
  if (pattern) return map[pattern];
  const prefix = keys.filter((k) => k !== "/" && !k.includes("/:") && path.startsWith(`${k}/`)).sort((a, b) => b.length - a.length)[0];
  return prefix ? map[prefix] : undefined;
}

/** "<Page> · <Tool> · ConstructHUB" for a growth-app path, or undefined when the route has no entry. */
export function appPageTitle(pathname: string): string | undefined {
  const t = titleEntryFor(APP_PAGE_TITLES, pathname);
  return t ? `${t} · ${APP_BRAND}` : undefined;
}

/** "<Page> · ConstructHub CRM" for a CRM portal path; the bare brand for a route without an entry (home fallback). */
export function crmPageTitle(pathname: string): string {
  const t = titleEntryFor(CRM_PAGE_TITLES, pathname);
  return t ? `${t} · ${CRM_BRAND}` : CRM_BRAND;
}
