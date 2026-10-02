/**
 * The signed-in home dashboard: the GET /api/dashboard contract and the tile
 * catalogue both lanes read. docs/dashboard/SPEC.md is the prose version.
 *
 * One server-side aggregate per signed-in user (server/dashboard/**): every
 * tile is computed on its own (Promise.allSettled, 3 s per tile), so one
 * failing source shows one "error" tile and never breaks the page. Numbers are
 * the account's own (user-scoped) or the active CRM org's (org-scoped) — never
 * estimated, never sample data outside `fixture: true`.
 */
import type { AddonKey, ModuleKey, PlanKey } from "./plans";
import type { DashboardClearedItem, DashboardHiddenTile, DashboardLayout } from "./dashboard-prefs";

// ---------------------------------------------------------------------------
// Groups and tiles

export type DashboardGroupKey = "grow" | "protect" | "win" | "run" | "learn";

export const DASHBOARD_GROUPS: readonly { key: DashboardGroupKey; label: string; blurb: string }[] = [
  { key: "grow", label: "Grow", blurb: "Your Google profiles, reviews, posts and website." },
  { key: "protect", label: "Protect", blurb: "Click fraud, VPN traffic, Cloudflare and your domains." },
  { key: "win", label: "Win jobs", blurb: "Permits, property records, competitors and ads." },
  { key: "run", label: "Run the business", blurb: "Texting, call answering and your team. Your CRM numbers are at the top." },
  { key: "learn", label: "Learn", blurb: "Master Class, guides and services." },
];

export type DashboardTileKey =
  // grow
  | "gbp" | "reviews" | "profileGuard" | "rankingGrid" | "gbpContent" | "social" | "siteScan" | "media"
  // protect
  | "clickGuard" | "ipTracker" | "vpnShield" | "cloudflare" | "searchConsole" | "domains" | "mailAlerts"
  // win
  | "permits" | "property" | "competitors" | "adsManager" | "lsaLeads"
  // run
  | "crm" | "crmSchedule" | "crmLeads" | "texting" | "callAssistant" | "agency"
  // learn
  | "masterClass" | "guides" | "reinstatement";

/**
 * Where a link lives. "app" paths are on this host (wouter <Link>); "portal"
 * paths are on the CRM host — the client resolves them with portalUrl()
 * (client/src/lib/site.ts) and navigates with a full page load.
 */
export type DashboardSurface = "app" | "portal";

/** Who may see a tile's numbers. The server decides `entitled`; this documents the rule. */
export type DashboardGate =
  /** No server gate today: every signed-in account. */
  | { kind: "none" }
  /** Any active plan (requirePlan with no test). */
  | { kind: "plan" }
  /** A plan whose allowance for `limit` is not 0 (e.g. protectedSites); the cheapest such plan comes from PLANS. */
  | { kind: "allowance"; limit: "protectedSites" | "competitorScans" | "teamTextSegments" }
  /** An Agency-only module (requireModule). */
  | { kind: "module"; module: ModuleKey }
  /** Membership of a CRM org (the CRM is included with every plan). */
  | { kind: "crm" }
  /**
   * A CRM feature metered on the org OWNER's plan (texting): a member of an org
   * gets past the gate and the source reads the owner's plan; without an org,
   * the viewer's own allowance for `limit` decides.
   */
  | { kind: "crmAllowance"; limit: "teamTextSegments" }
  /** An add-on not sold yet: the tile is always "coming_soon" in this build. */
  | { kind: "addon"; addon: AddonKey | "call_assistant"; requiredPlan: PlanKey };

export type DashboardTileDef = {
  key: DashboardTileKey;
  group: DashboardGroupKey;
  title: string;
  /** One line under the title; also the empty-state copy. */
  description: string;
  href: string;
  surface: DashboardSurface;
  gate: DashboardGate;
  /** Client feature flag that hides the tile entirely (client/src/lib/features.ts). */
  flag?: "SHOW_GOOGLE_REVIEWS" | "SHOW_COMPETITOR_INTEL";
  /** Extra links shown under the metrics. */
  links?: readonly DashboardLink[];
};

/**
 * Every tile, in display order within its group. The server emits tiles in
 * this order; the client groups them by `group` in DASHBOARD_GROUPS order.
 * The "crm" tile renders as the CRM snapshot card above the grid, not in it.
 */
export const DASHBOARD_TILES: readonly DashboardTileDef[] = [
  // ── Grow ─────────────────────────────────────────────────────────────────
  { key: "gbp", group: "grow", title: "Google Business Profile", description: "Connect Google and link the locations you manage.", href: "/locations", surface: "app", gate: { kind: "plan" }, links: [{ label: "GMB Edit Monitor", href: "/gmb-monitor", surface: "app" }] },
  { key: "reviews", group: "grow", title: "Google Reviews", description: "Your rating, new reviews and the ones still waiting on a reply.", href: "/google-reviews", surface: "app", gate: { kind: "plan" }, flag: "SHOW_GOOGLE_REVIEWS" },
  { key: "profileGuard", group: "grow", title: "Profile Guard", description: "Alerts when someone edits your Google profile. Turn it on per location in Locations.", href: "/locations", surface: "app", gate: { kind: "plan" } },
  { key: "rankingGrid", group: "grow", title: "GMB Ranking Grid", description: "Where you rank on the map, street by street.", href: "/ranking-grid", surface: "app", gate: { kind: "plan" } },
  { key: "gbpContent", group: "grow", title: "Posts & Photos", description: "Scheduled Google posts and photo uploads.", href: "/gbp-content", surface: "app", gate: { kind: "plan" } },
  { key: "social", group: "grow", title: "Social Media", description: "Posts queued and published across your social accounts.", href: "/social-media", surface: "app", gate: { kind: "none" } },
  { key: "siteScan", group: "grow", title: "Site Scan", description: "SEO and speed score for your website.", href: "/site-scan", surface: "app", gate: { kind: "plan" } },
  { key: "media", group: "grow", title: "Photo Optimizer", description: "Geotagged, compressed job photos in your media library.", href: "/media-library", surface: "app", gate: { kind: "plan" }, links: [{ label: "Optimize photos", href: "/photos", surface: "app" }] },
  // ── Protect ──────────────────────────────────────────────────────────────
  { key: "clickGuard", group: "protect", title: "Click Guard", description: "Suspicious ad clicks caught and IPs excluded.", href: "/google-ads", surface: "app", gate: { kind: "allowance", limit: "protectedSites" } },
  { key: "ipTracker", group: "protect", title: "IP Tracker", description: "Who visited your website this week.", href: "/ip-tracker", surface: "app", gate: { kind: "allowance", limit: "protectedSites" } },
  { key: "vpnShield", group: "protect", title: "VPN Shield", description: "VPN and proxy visits blocked from your site.", href: "/vpn-shield", surface: "app", gate: { kind: "allowance", limit: "protectedSites" } },
  { key: "cloudflare", group: "protect", title: "Cloudflare", description: "Zones, traffic and edge rules for client sites.", href: "/cloudflare", surface: "app", gate: { kind: "module", module: "cloudflareSearchConsole" } },
  { key: "searchConsole", group: "protect", title: "Search Console", description: "Google search clicks and impressions.", href: "/search-console", surface: "app", gate: { kind: "module", module: "cloudflareSearchConsole" } },
  { key: "domains", group: "protect", title: "Domains", description: "Expiry, auto-renew and DNS checks on your domains.", href: "/domains", surface: "app", gate: { kind: "module", module: "domainsMailAlerts" } },
  { key: "mailAlerts", group: "protect", title: "Mail alerts", description: "Provider alert emails, matched to your clients.", href: "/mail-alerts", surface: "app", gate: { kind: "module", module: "domainsMailAlerts" } },
  // ── Win jobs ─────────────────────────────────────────────────────────────
  { key: "permits", group: "win", title: "Search Permits", description: "Search building permits by county or city.", href: "/search", surface: "app", gate: { kind: "plan" }, links: [{ label: "Search history", href: "/history", surface: "app" }, { label: "Database directory", href: "/databases", surface: "app" }] },
  { key: "property", group: "win", title: "Property Records", description: "Owner and parcel lookups through county appraiser offices, sourced from NETR Online.", href: "/property", surface: "app", gate: { kind: "none" } },
  { key: "competitors", group: "win", title: "Competitor Intel", description: "Benchmark your profile against local competitors.", href: "/competitors", surface: "app", gate: { kind: "allowance", limit: "competitorScans" }, flag: "SHOW_COMPETITOR_INTEL" },
  { key: "adsManager", group: "win", title: "Agency Ads & LSA", description: "Client ad accounts, audits and protections.", href: "/ads-manager", surface: "app", gate: { kind: "module", module: "adsManager" } },
  { key: "lsaLeads", group: "win", title: "LSA Leads", description: "Local Services leads, disputes and Telegram alerts.", href: "/lsa-leads", surface: "app", gate: { kind: "none" } },
  // ── Run the business ─────────────────────────────────────────────────────
  { key: "crm", group: "run", title: "ConstructHub CRM", description: "Estimates, jobs, invoices and your pipeline.", href: "/crm", surface: "portal", gate: { kind: "crm" } },
  { key: "crmSchedule", group: "run", title: "Schedule", description: "Appointments and crew visits.", href: "/crm/schedule", surface: "portal", gate: { kind: "crm" } },
  { key: "crmLeads", group: "run", title: "Leads & follow-ups", description: "New leads and the follow-ups that are due.", href: "/crm/pipeline", surface: "portal", gate: { kind: "crm" } },
  { key: "texting", group: "run", title: "Texting", description: "Team alerts and client texts from your CRM.", href: "/crm/settings", surface: "portal", gate: { kind: "crmAllowance", limit: "teamTextSegments" } },
  { key: "callAssistant", group: "run", title: "AI Call Assistant", description: "An assistant that answers your calls 24/7 and files the lead in your CRM.", href: "/call-assistant", surface: "app", gate: { kind: "addon", addon: "call_assistant", requiredPlan: "pro" } },
  { key: "agency", group: "run", title: "Agency workspace", description: "Client workspaces, team roles and bulk actions.", href: "/agency", surface: "app", gate: { kind: "module", module: "agencyWorkspace" } },
  // ── Learn ────────────────────────────────────────────────────────────────
  { key: "masterClass", group: "learn", title: "Master Class", description: "The contractor marketing course.", href: "/master-class", surface: "app", gate: { kind: "none" } },
  { key: "guides", group: "learn", title: "Guides", description: "Google Ads, Local Services and state licensing guides.", href: "/guides", surface: "app", gate: { kind: "none" }, links: [{ label: "Google Ads guide", href: "/google-ads-guide", surface: "app" }, { label: "LSA guide", href: "/lsa-guide", surface: "app" }, { label: "Ad fraud", href: "/google-ad-fraud", surface: "app" }] },
  { key: "reinstatement", group: "learn", title: "Reinstatement", description: "Suspended Google profile? We handle the appeal.", href: "/reinstatement", surface: "app", gate: { kind: "none" } },
];

export const DASHBOARD_TILE_KEYS: readonly DashboardTileKey[] = DASHBOARD_TILES.map((t) => t.key);
export const dashboardTileDef = (key: DashboardTileKey): DashboardTileDef =>
  DASHBOARD_TILES.find((t) => t.key === key)!;

// ---------------------------------------------------------------------------
// Payload

export type DashboardLink = { label: string; href: string; surface: DashboardSurface };

export type DashboardMetricFormat =
  /** Integer count: 1,234. */
  | "count"
  /** Money in cents: $12,345 (client formats with formatUsd from shared/plan-copy). */
  | "cents"
  /** 0–100 score. */
  | "score"
  /** Star rating 1–5, one decimal. */
  | "rating"
  /** ISO timestamp, shown relative ("2 days ago"). */
  | "datetime"
  /** Pre-formatted text, shown as is. */
  | "text";

export type DashboardMetric = {
  /** Stable within the tile: data-testid `metric-<tileKey>-<key>`. */
  key: string;
  label: string;
  /** null = unknown / not measured yet (the client shows "—"), never a guess. */
  value: number | string | null;
  format: DashboardMetricFormat;
  /** "used of limit" meters: -1 unlimited (fair use). Client shows "3 of 15". */
  limit?: number;
  /** Small text under the value ("this month", "$4,200 open"). */
  hint?: string;
  /** Colour hint only; the label carries the meaning. */
  tone?: "default" | "good" | "warn" | "bad";
};

export type DashboardTileStatus =
  /** Numbers are in. */
  | "ok"
  /** Entitled but not set up yet: no metrics, `cta` says how to start. */
  | "empty"
  /** The source failed or took longer than 3 s: `message` says so, the tile still links to its page. */
  | "error"
  /** The plan doesn't include it: `requiredPlan` (+ `module`) for the standard plan_required prompt. No feature data is read. */
  | "locked"
  /** Not built yet (AI Call Assistant). */
  | "coming_soon";

export type DashboardTile = {
  key: DashboardTileKey;
  group: DashboardGroupKey;
  title: string;
  description: string;
  href: string;
  surface: DashboardSurface;
  entitled: boolean;
  /** Cheapest plan that includes the tile, when `entitled` is false. */
  requiredPlan?: PlanKey;
  /** The Agency-only module behind a locked tile (MODULE_NAMES in shared/plans). */
  module?: ModuleKey;
  /** The add-on behind a coming-soon / add-on tile. */
  addon?: AddonKey | "call_assistant";
  status: DashboardTileStatus;
  /** Human sentence for error / locked / coming_soon / empty states. */
  message?: string;
  metrics: DashboardMetric[];
  cta?: DashboardLink;
  links?: DashboardLink[];
  /** When these numbers were computed (ISO). */
  updatedAt: string;
};

export type DashboardUsageKey =
  | "searches" | "rankings" | "siteScans" | "competitorScans" | "texts" | "locations" | "protectedSites" | "crmSeats";

export type DashboardUsage = {
  key: DashboardUsageKey;
  label: string;
  used: number;
  /** -1 unlimited (fair use). Meters whose limit is 0 (not in the plan) are omitted. */
  limit: number;
  /** "monthly" resets on account.resetsAt; "count" is a standing count (locations, sites, seats). */
  period: "monthly" | "count";
  href: string;
  /**
   * Where `href` lives (optional). Absent = "app", except a "/crm/…" path, which the
   * client treats as "portal". The aggregator sets "portal" on crmSeats.
   */
  surface?: DashboardSurface;
};

export type DashboardAccountStatus = "active" | "trialing" | "past_due" | "none";

export type DashboardAccount = {
  /** For the greeting: first word of displayName, else null (client says "Welcome back"). */
  firstName: string | null;
  displayName: string | null;
  /** The account's own plan (null = no active plan). */
  plan: PlanKey | null;
  /** Name of the plan whose limits apply (accessPlan; platform admins run on the top plan). */
  planName: string | null;
  status: DashboardAccountStatus;
  isPlatformAdmin: boolean;
  /** End of a trial or trial-code grant (ISO), else null. */
  trialEndsAt: string | null;
  /** Next renewal / period end for a paid Stripe plan (ISO), else null. Null when the plan is set to cancel. */
  renewsAt: string | null;
  /** Backend lane extension: when a Stripe plan set to cancel ends (ISO). Absent otherwise. */
  endsAt?: string | null;
  usage: DashboardUsage[];
  /** When the monthly counts reset (first of next month, UTC). */
  resetsAt: string;
  unreadNotifications: number;
};

export type DashboardChecklistKey =
  | "connectGoogle" | "addLocation" | "turnOnGuard" | "runSiteScan" | "requestReviews"
  | "protectWebsite" | "setUpCrm" | "inviteTeammate" | "addTextingNumber";

export type DashboardChecklistItem = {
  key: DashboardChecklistKey;
  label: string;
  description: string;
  done: boolean;
  href: string;
  surface: DashboardSurface;
};

export type DashboardRecentItem = {
  /** Unique across sources: "n:<id>" notification, "c:<id>" CRM team activity. */
  id: string;
  at: string;
  source: "notification" | "crm";
  title: string;
  body?: string;
  href?: string;
  surface: DashboardSurface;
  severity: "info" | "warning" | "critical";
  /** Notifications only: not read yet. */
  unread?: boolean;
};

export type DashboardPayload = {
  generatedAt: string;
  /** True when this answer came from the 60 s per-user cache. */
  cached: boolean;
  /** True only for the skeleton's sample payload; the client shows a "Sample data" badge. */
  fixture: boolean;
  account: DashboardAccount;
  /**
   * Every tile the user shows, in their layout's order (DASHBOARD_TILES order
   * by default). Flagged-off tiles included; the client drops them. Tiles the
   * user hid are not computed: they are in `hiddenTiles`.
   */
  tiles: DashboardTile[];
  /**
   * "Needs you today" (dashboardAttention over `tiles` + `account`), minus the
   * items the user cleared or snoozed. Computed by the server.
   */
  attention: DashboardAttentionItem[];
  /** Cleared or snoozed items that still hold (same value, snooze not over): "Show cleared (N)". */
  cleared: DashboardClearedItem[];
  /** The user's layout (shared/dashboard-prefs.ts), complete and valid; the default when never customized. */
  layout: DashboardLayout;
  /** Tiles the user hid: plan access only, no numbers (the Customize sheet lists them). */
  hiddenTiles: DashboardHiddenTile[];
  /** Getting-started steps that apply to this plan; the card hides when every one is done. */
  checklist: DashboardChecklistItem[];
  /** Newest first, at most 12. */
  recent: DashboardRecentItem[];
};

/** Per-tile time budget on the server. */
export const DASHBOARD_TILE_TIMEOUT_MS = 3000;
/** Per-user cache lifetime on the server. */
export const DASHBOARD_CACHE_MS = 60_000;
/** Client staleTime / refetch cadence for GET /api/dashboard. */
export const DASHBOARD_CLIENT_STALE_MS = 60_000;

// ---------------------------------------------------------------------------
// "Needs you today"

/** One thing on the page that wants action, pulled to the top of the dashboard. */
export type DashboardAttentionItem = {
  /** Stable: "<tileKey>.<metricKey>", "usage.<key>", "notifications" or "billing". */
  key: string;
  /** Where it comes from, for the small label ("Click Guard", "Plan usage"). */
  source: string;
  label: string;
  value: DashboardMetric["value"];
  format: DashboardMetricFormat;
  limit?: number;
  hint?: string;
  tone: "warn" | "bad";
  href: string;
  surface: DashboardSurface;
};

/**
 * The action list: every metric the server already marked "warn" or "bad" on a
 * tile that answered, the usage meters at or over their limit, unread alerts
 * and a past-due plan. Nothing new is measured here; "bad" comes first, then
 * page order. Pass the tiles the client shows (feature flags applied).
 */
export function dashboardAttention(tiles: readonly DashboardTile[], account: DashboardAccount): DashboardAttentionItem[] {
  const out: DashboardAttentionItem[] = [];
  if (account.status === "past_due") {
    out.push({ key: "billing", source: "Billing", label: "Payment past due", value: account.planName, format: "text", tone: "bad", href: "/settings?tab=billing", surface: "app" });
  }
  // Leads and schedule are shown with the CRM card: their links go to their own CRM pages.
  for (const t of tiles) {
    if (t.status !== "ok") continue;
    for (const m of t.metrics) {
      if (m.tone !== "warn" && m.tone !== "bad") continue;
      out.push({
        key: `${t.key}.${m.key}`, source: t.title, label: m.label, value: m.value, format: m.format,
        ...(m.limit !== undefined ? { limit: m.limit } : {}), ...(m.hint ? { hint: m.hint } : {}),
        tone: m.tone, href: t.cta?.href ?? t.href, surface: t.cta?.surface ?? t.surface,
      });
    }
  }
  for (const u of account.usage) {
    if (u.limit <= 0) continue;
    // A standing count AT its limit is just "all in use"; only over it needs a decision.
    const over = u.period === "count" ? u.used > u.limit : u.used >= u.limit;
    if (!over) continue;
    out.push({
      key: `usage.${u.key}`, source: "Plan usage", label: u.label, value: u.used, format: "count", limit: u.limit,
      hint: u.period === "count" ? "Over your plan's limit" : "Limit reached this month",
      tone: u.period === "count" ? "warn" : "bad",
      href: u.href, surface: u.surface ?? (u.href.startsWith("/crm/") || u.href === "/crm" ? "portal" : "app"),
    });
  }
  if (account.unreadNotifications > 0) {
    out.push({ key: "notifications", source: "Alerts", label: "Unread alerts", value: account.unreadNotifications, format: "count", tone: "warn", href: "/settings?tab=notifications", surface: "app" });
  }
  return [...out.filter((i) => i.tone === "bad"), ...out.filter((i) => i.tone === "warn")];
}
