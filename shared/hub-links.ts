/**
 * The only links Hub may put in an answer, shared by the server (output filter
 * O6, prompt LINKS list) and the client (the answer renderer). A link is
 * allowed only when its path is listed here exactly, with an optional query or
 * hash taken from that entry's `variants`. Everything else is blocked on the
 * server and rendered as plain text in the browser.
 *
 * `public` links may appear in answers for signed-out visitors (preset
 * answers); the rest are pages that need an account.
 */

export type HubLink = { path: string; label: string; public: boolean; variants?: readonly string[] };

export const HUB_LINKS: readonly HubLink[] = [
  { path: "/", label: "ConstructHUB home", public: true },
  { path: "/pricing", label: "Pricing", public: true, variants: ["#plans", "#crm", "#comparison", "#agency", "#add-ons", "#services"] },
  { path: "/auth", label: "Create an account", public: true },
  { path: "/databases", label: "Database Directory", public: true },
  { path: "/property", label: "Property Records", public: true },
  { path: "/free-site-scan", label: "Free website scan", public: true },
  { path: "/master-class", label: "Master Class", public: true },
  { path: "/master-class-landing", label: "Master Class", public: true },
  { path: "/reinstatement", label: "Reinstatement", public: true },
  { path: "/google-ads-guide", label: "Google Ads Guide", public: true },
  { path: "/lsa-guide", label: "LSA Guide", public: true },
  { path: "/google-ad-fraud", label: "Ad Fraud", public: true },
  { path: "/crm-app", label: "ConstructHub CRM", public: true },
  { path: "/call-assistant", label: "AI Call Assistant", public: true },
  { path: "/privacy", label: "Privacy Policy", public: true },
  { path: "/terms", label: "Terms of Use", public: true },
  { path: "/settings", label: "Settings", public: false, variants: ["?tab=profile", "?tab=account", "?tab=notifications", "?tab=security", "?tab=billing"] },
  { path: "/search", label: "Search Permits", public: false },
  { path: "/history", label: "Search History", public: false },
  { path: "/locations", label: "Locations", public: false },
  { path: "/google-reviews", label: "Google Reviews", public: false },
  { path: "/gbp-content", label: "Posts & Photos", public: false },
  { path: "/gmb-monitor", label: "GMB Edit Monitor", public: false },
  { path: "/ranking-grid", label: "GMB Ranking Grid", public: false },
  { path: "/photos", label: "Photo Optimizer", public: false },
  { path: "/media-library", label: "Media Library", public: false },
  { path: "/site-scan", label: "Site Scan", public: false },
  { path: "/social-media", label: "Social Media", public: false },
  { path: "/guides", label: "Guides", public: false },
  { path: "/google-ads", label: "Click Guard", public: false },
  { path: "/ip-tracker", label: "IP Tracker", public: false },
  { path: "/vpn-shield", label: "VPN Shield", public: false },
  { path: "/competitors", label: "Competitor Intel", public: false },
  { path: "/ads-manager", label: "Agency Ads & LSA", public: false },
  { path: "/lsa-leads", label: "LSA Leads", public: false },
  { path: "/cloudflare", label: "Cloudflare", public: false },
  { path: "/search-console", label: "Search Console", public: false },
  { path: "/domains", label: "Domains", public: false },
  { path: "/mail-alerts", label: "Mail alerts", public: false },
  { path: "/agency", label: "Agency", public: false },
  { path: "/crm/clients", label: "CRM → Clients", public: false },
  { path: "/crm/estimates", label: "CRM → Estimates", public: false },
  { path: "/crm/invoices", label: "CRM → Invoices", public: false },
  { path: "/crm/payments", label: "CRM → Payments", public: false },
  { path: "/crm/pipeline", label: "CRM → Pipeline", public: false },
  { path: "/crm/schedule", label: "CRM → Schedule", public: false },
  { path: "/crm/inbox", label: "CRM → Messages", public: false },
  { path: "/crm/pricebook", label: "CRM → Price book", public: false },
  { path: "/crm/team", label: "CRM → Team & Company", public: false },
  { path: "/crm/integrations", label: "CRM → Integrations", public: false },
  { path: "/crm/settings", label: "CRM → Settings", public: false },
  { path: "/crm/migrate", label: "CRM → Import", public: false },
];

const BY_PATH = new Map(HUB_LINKS.map((l) => [l.path, l]));

/**
 * The allowlisted entry for a relative href ("/pricing#services"), or null.
 * Only an exact path plus one exact variant is accepted — no other query,
 * hash, encoding, dot segment or host.
 */
export function hubLinkFor(href: string): HubLink | null {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return null;
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const suffix = cut === -1 ? "" : href.slice(cut);
  const link = BY_PATH.get(path);
  if (!link) return null;
  if (suffix && !(link.variants ?? []).includes(suffix)) return null;
  return link;
}

/** Feature pages Hub knows about: the browser sends only this key, never free text. */
export const PAGE_KEYS = [
  "home", "pricing", "permits", "locations", "profile-guard", "gmb-monitor", "reviews", "posts", "photos",
  "ranking-grid", "site-scan", "social", "click-guard", "ip-tracker", "vpn-shield", "competitors", "google-ads",
  "cloudflare", "domains", "agency", "reinstatement", "crm", "settings", "master-class", "call-assistant",
] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

/** pageKey -> the feature name told to the model and the knowledge sections it pulls in. */
export const HUB_PAGES: Record<PageKey, { name: string; sections: number[] }> = {
  "home": { name: "ConstructHUB home", sections: [1] },
  "pricing": { name: "Pricing", sections: [3] },
  "permits": { name: "Permits & Databases", sections: [4] },
  "locations": { name: "Locations", sections: [5] },
  "profile-guard": { name: "Profile Guard", sections: [6] },
  "gmb-monitor": { name: "GMB Edit Monitor", sections: [7] },
  "reviews": { name: "Google Reviews", sections: [8] },
  "posts": { name: "Posts & Photos", sections: [9] },
  "photos": { name: "Photo Optimizer", sections: [10] },
  "ranking-grid": { name: "GMB Ranking Grid", sections: [11] },
  "site-scan": { name: "Site Scan", sections: [12] },
  "social": { name: "Social Media", sections: [14] },
  "click-guard": { name: "Click Guard", sections: [15] },
  "ip-tracker": { name: "IP Tracker", sections: [16] },
  "vpn-shield": { name: "VPN Shield", sections: [17] },
  "competitors": { name: "Competitor Intel", sections: [18] },
  "google-ads": { name: "Google Ads tools and guides", sections: [19] },
  "cloudflare": { name: "Cloudflare and Search Console", sections: [20] },
  "domains": { name: "Domains and Mail alerts", sections: [21] },
  "agency": { name: "Agency workspace", sections: [22] },
  "reinstatement": { name: "GBP Reinstatement", sections: [23] },
  "crm": { name: "ConstructHub CRM", sections: [24] },
  "settings": { name: "Settings", sections: [25] },
  "master-class": { name: "Master Class", sections: [26] },
  // §30 of the knowledge pack (it lives in the CRM, but §24 would not fit in the same slice).
  "call-assistant": { name: "AI Call Assistant", sections: [30] },
};

const PAGE_ROUTES: [string, PageKey][] = [
  ["/pricing", "pricing"], ["/search", "permits"], ["/databases", "permits"], ["/property", "permits"],
  ["/history", "permits"], ["/locations", "locations"], ["/gmb-monitor", "gmb-monitor"],
  ["/google-reviews", "reviews"], ["/gbp-content", "posts"], ["/photos", "photos"], ["/media-library", "photos"],
  ["/ranking-grid", "ranking-grid"], ["/site-scan", "site-scan"], ["/free-site-scan", "site-scan"],
  ["/social-media", "social"], ["/guides", "social"], ["/google-ads-guide", "google-ads"],
  ["/google-ad-fraud", "google-ads"], ["/google-ads-landing", "click-guard"], ["/google-ads", "click-guard"],
  ["/ip-tracker", "ip-tracker"], ["/vpn-shield", "vpn-shield"], ["/competitors", "competitors"],
  ["/ads-manager", "google-ads"], ["/lsa-guide", "google-ads"], ["/lsa-leads", "google-ads"],
  ["/cloudflare", "cloudflare"], ["/search-console", "cloudflare"], ["/domains", "domains"],
  ["/mail-alerts", "domains"], ["/agency", "agency"], ["/reinstatement", "reinstatement"],
  ["/crm-app", "crm"], ["/crm", "crm"], ["/settings", "settings"], ["/master-class", "master-class"],
  ["/google-business", "locations"], ["/permits-landing", "permits"], ["/call-assistant", "call-assistant"],
];
// Longest prefix first, so "/search-console" never falls into "/search".
PAGE_ROUTES.sort((a, b) => b[0].length - a[0].length);

/** The page key for a route, or undefined. `portal` = the CRM host, where every page is the CRM. */
export function pageKeyForPath(path: string, portal = false): PageKey | undefined {
  if (portal) return "crm";
  if (path === "/" || path === "/landing") return "home";
  for (const [prefix, key] of PAGE_ROUTES) {
    if (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}-`)) return key;
  }
  return undefined;
}
