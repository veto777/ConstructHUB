/**
 * SAMPLE payloads for GET /api/dashboard while the real aggregator is built
 * (docs/dashboard/SPEC.md → lanes). Every answer built here carries
 * `fixture: true` and the client shows a "Sample data" badge: these numbers
 * describe no real account. The backend lane replaces the route's use of this
 * file with the aggregator and may keep it for client-shape tests only.
 *
 * Scenarios (?fixture= on the skeleton route):
 *   full    — Growth plan, set up: every status appears (Photo Optimizer is the empty one, Social Media the error)
 *   new     — Starter plan, signed up today: checklist open, most tiles empty
 *   noplan  — no active plan: plan-gated tiles locked
 */
import { PLANS, type PlanKey, type PlanLimits, type PlanModules } from "@shared/plans";
import {
  DASHBOARD_TILES, dashboardAttention,
  type DashboardAccount, type DashboardChecklistItem, type DashboardMetric, type DashboardPayload, type DashboardRecentItem,
  type DashboardTile, type DashboardTileKey, type DashboardUsage,
} from "@shared/dashboard";
import { defaultDashboardLayout, splitDashboardTiles, type DashboardLayout } from "@shared/dashboard-prefs";
import { cheapestPlanAllowing, tileAccess } from "./access";
import { CTA_START, COMING_SOON_MESSAGE, lockedMessage } from "./copy";

export type DashboardFixtureScenario = "full" | "new" | "noplan";
export const DASHBOARD_FIXTURE_SCENARIOS: readonly DashboardFixtureScenario[] = ["full", "new", "noplan"];

const NO_MODULES: PlanModules = { agencyWorkspace: false, adsManager: false, cloudflareSearchConsole: false, domainsMailAlerts: false };

const m = (key: string, label: string, value: DashboardMetric["value"], format: DashboardMetric["format"], extra: Partial<DashboardMetric> = {}): DashboardMetric =>
  ({ key, label, value, format, ...extra });

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();
const HOUR = 3_600_000, DAY = 24 * HOUR;

/** Sample metrics for a set-up account. */
function fullMetrics(key: DashboardTileKey, now: Date, limits: PlanLimits): DashboardMetric[] {
  switch (key) {
    case "gbp": return [m("googleAccounts", "Google accounts", 1, "count"), m("syncIssues", "Sync issues", 0, "count", { tone: "good" }), m("locations", "Locations linked", 2, "count", { limit: limits.locations })];
    case "reviews": return [m("rating", "Average rating", 4.7, "rating"), m("newThisWeek", "New this week", 3, "count", { tone: "good" }), m("unanswered", "Awaiting reply", 2, "count", { tone: "warn" })];
    case "profileGuard": return [m("pending", "Edits to review", 1, "count", { tone: "warn" }), m("guarded", "Locations guarded", 2, "count"), m("lastCheck", "Last check", ago(now, 12 * 60_000), "datetime")];
    case "rankingGrid": return [m("averageRank", "Average rank (last grid)", "4.2", "text"), m("lastScan", "Last grid", ago(now, 3 * DAY), "datetime"), m("credits", "Credits used", 6, "count", { limit: limits.gridCredits, hint: "this month" })];
    case "gbpContent": return [m("scheduled", "Scheduled", 5, "count"), m("published30d", "Published (30 days)", 9, "count"), m("attention", "Need attention", 0, "count", { tone: "good" })];
    case "siteScan": return [m("score", "Last score", 82, "score", { tone: "good" }), m("scans", "Scans used", 2, "count", { limit: limits.siteScans, hint: "this month" }), m("lastScan", "Last scan", ago(now, 5 * DAY), "datetime")];
    case "clickGuard": return [m("suspicious30d", "Suspicious clicks (30 days)", 17, "count", { tone: "warn" }), m("blockedIps", "IPs excluded", 9, "count"), m("sites", "Sites protected", 1, "count", { limit: limits.protectedSites })];
    case "ipTracker": return [m("visits7d", "Visits (7 days)", 412, "count"), m("unique7d", "Unique visitors", 268, "count")];
    case "vpnShield": return [m("blocked30d", "VPN visits blocked (30 days)", 23, "count"), m("uniqueIps30d", "Unique IPs", 19, "count")];
    case "permits": return [m("searches7d", "Searches (7 days)", 12, "count"), m("lastSearch", "Last search", ago(now, 2 * HOUR), "datetime"), m("searches", "Searches used", 41, "count", { limit: limits.permitSearches, hint: "this month" })];
    case "competitors": return [m("found", "Competitors found", 14, "count", { hint: "last scan" }), m("lastScan", "Last scan", ago(now, 9 * DAY), "datetime"), m("scans", "Scans used", 3, "count", { limit: limits.competitorScans, hint: "this month" })];
    case "lsaLeads": return [m("leads30d", "Leads (30 days)", 11, "count"), m("disputes", "Disputes pending", 1, "count", { tone: "warn" }), m("lastSync", "Last sync", ago(now, 40 * 60_000), "datetime")];
    case "crm": return [
      m("pipeline", "Pipeline value", 18_450_000, "cents", { hint: "7 open projects" }),
      m("openEstimates", "Open estimates", 4, "count", { hint: "$62,300 quoted" }),
      m("jobsWon", "Jobs won", 12, "count", { hint: "$141,900 approved", tone: "good" }),
      m("openInvoices", "Open invoices", 3, "count", { hint: "$9,800 due" }),
      m("unscheduled", "Sold, not scheduled", 2, "count", { tone: "warn" }),
      m("clients", "Active clients", 38, "count"),
    ];
    case "crmSchedule": return [m("today", "Today", 2, "count"), m("week", "Next 7 days", 9, "count")];
    case "crmLeads": return [m("newLeads7d", "New leads (7 days)", 5, "count", { tone: "good" }), m("followUpsDue", "Follow-ups due", 3, "count", { tone: "warn" }), m("needEstimate", "Leads without an estimate", 4, "count", { tone: "warn" })];
    case "texting": return [m("clientTexting", "Client texting", "On", "text", { tone: "good" }), m("segments", "Texts used", 214, "count", { limit: limits.teamTextSegments, hint: "this month" })];
    case "masterClass": return [m("owned", "Modules unlocked", 0, "count", { hint: "of 12" })];
    default: return [];
  }
}

/** Tiles that are just links (no per-account numbers) still render as "ok". */
const LINK_ONLY: ReadonlySet<DashboardTileKey> = new Set(["guides", "reinstatement", "property"]);


function tileFor(scenario: DashboardFixtureScenario, def: (typeof DASHBOARD_TILES)[number], now: Date, plan: PlanKey | null, modules: PlanModules, hasCrmOrg: boolean): DashboardTile {
  const limits = plan ? PLANS[plan].limits : null;
  const access = tileAccess(def, { accessPlan: plan, allowances: limits, modules, hasCrmOrg });
  const base: DashboardTile = {
    key: def.key, group: def.group, title: def.title, description: def.description, href: def.href, surface: def.surface,
    entitled: access.entitled, status: "ok", metrics: [], updatedAt: now.toISOString(),
    ...(def.links ? { links: [...def.links] } : {}),
    ...(access.requiredPlan && !access.entitled ? { requiredPlan: access.requiredPlan } : {}),
    ...(access.module ? { module: access.module } : {}),
    ...(access.addon ? { addon: access.addon } : {}),
  };
  if (access.comingSoon) {
    return { ...base, status: "coming_soon", message: COMING_SOON_MESSAGE, cta: { label: "See add-ons", href: "/pricing#add-ons", surface: "app" } };
  }
  if (!access.entitled) {
    return { ...base, status: "locked", message: lockedMessage(access.requiredPlan), cta: { label: "See plans", href: "/pricing", surface: "app" } };
  }
  // Texting follows the CRM org owner's plan: an org on a plan without texting is locked by the source.
  if (def.key === "texting" && limits && limits.teamTextSegments === 0) {
    const requiredPlan = cheapestPlanAllowing("teamTextSegments");
    return { ...base, entitled: false, requiredPlan, status: "locked", message: lockedMessage(requiredPlan), cta: { label: "See plans", href: "/pricing", surface: "app" } };
  }
  if (def.key === "property") return { ...base, cta: { label: "Look up a property", href: def.href, surface: def.surface } };
  if (LINK_ONLY.has(def.key)) return base;
  const start = { label: CTA_START[def.key] ?? "Open", href: def.href, surface: def.surface };
  if (scenario === "full") {
    // One failing source, to show that the page survives it.
    if (def.key === "social") return { ...base, status: "error", message: "Social Media didn't answer in time. Open the page for live numbers.", cta: { label: "Open Social Media", href: def.href, surface: def.surface } };
    const metrics = fullMetrics(def.key, now, limits!);
    if (!metrics.length) return { ...base, status: "empty", message: def.description, cta: start };
    return { ...base, metrics, cta: { label: def.key === "crm" ? "Open the CRM" : "Open", href: def.href, surface: def.surface } };
  }
  // new / noplan: nothing set up yet. Permit searches and property records still show their meter.
  if (def.key === "permits" && limits) {
    return { ...base, metrics: [m("searches7d", "Searches (7 days)", 0, "count"), m("lastSearch", "Last search", null, "datetime"), m("searches", "Searches used", 0, "count", { limit: limits.permitSearches, hint: "this month" })], cta: start };
  }
  return { ...base, status: "empty", message: def.description, cta: start };
}

function usageFor(plan: PlanKey | null, scenario: DashboardFixtureScenario): DashboardUsage[] {
  if (!plan) return [];
  const l = PLANS[plan].limits;
  const full = scenario === "full";
  const rows: DashboardUsage[] = [
    { key: "searches", label: "Permit searches", used: full ? 41 : 0, limit: l.permitSearches, period: "monthly", href: "/search" },
    { key: "rankings", label: "Ranking-grid credits", used: full ? 6 : 0, limit: l.gridCredits, period: "monthly", href: "/ranking-grid" },
    { key: "siteScans", label: "Site Scans", used: full ? 2 : 0, limit: l.siteScans, period: "monthly", href: "/site-scan" },
    { key: "competitorScans", label: "Competitor scans", used: full ? 3 : 0, limit: l.competitorScans, period: "monthly", href: "/competitors" },
    { key: "texts", label: "Texts", used: full ? 214 : 0, limit: l.teamTextSegments, period: "monthly", href: "/settings?tab=billing" },
    { key: "locations", label: "Locations", used: full ? 2 : 0, limit: l.locations, period: "count", href: "/locations" },
    { key: "protectedSites", label: "Protected websites", used: full ? 1 : 0, limit: l.protectedSites, period: "count", href: "/google-ads" },
    { key: "crmSeats", label: "CRM seats", used: full ? 4 : 1, limit: l.crmSeats, period: "count", href: "/crm/team?tab=team", surface: "portal" },
  ];
  return rows.filter((r) => r.limit !== 0);
}

function checklistFor(plan: PlanKey | null, scenario: DashboardFixtureScenario): DashboardChecklistItem[] {
  const full = scenario === "full";
  const l = plan ? PLANS[plan].limits : null;
  const items: (DashboardChecklistItem & { applies: boolean })[] = [
    { key: "connectGoogle", label: "Connect Google", description: "Link the Google account that manages your Business Profile.", done: full, href: "/locations", surface: "app", applies: true },
    { key: "addLocation", label: "Add a location", description: "Pick the business locations you want to manage here.", done: full, href: "/locations", surface: "app", applies: true },
    { key: "turnOnGuard", label: "Turn on Profile Guard", description: "Open a location in Locations and turn on its Profile Guard: an alert when someone edits your Google profile.", done: full, href: "/locations", surface: "app", applies: !!plan },
    { key: "runSiteScan", label: "Run a Site Scan", description: "See what's holding your website back in Google.", done: full, href: "/site-scan", surface: "app", applies: !!plan },
    { key: "requestReviews", label: "Ask for a review", description: "Send your last happy customer a review request.", done: false, href: "/google-reviews", surface: "app", applies: true },
    { key: "protectWebsite", label: "Protect your website", description: "Add Click Guard to the site your ads point at.", done: full, href: "/google-ads", surface: "app", applies: !!l && l.protectedSites !== 0 },
    { key: "setUpCrm", label: "Set up the CRM", description: "Your profile and company details print on every estimate.", done: full, href: "/crm", surface: "portal", applies: true },
    { key: "inviteTeammate", label: "Invite a teammate", description: "Add office staff or crew to the CRM.", done: full, href: "/crm/team?tab=team", surface: "portal", applies: true },
    { key: "addTextingNumber", label: "Turn on client texting", description: "Text clients estimates, reminders and updates.", done: false, href: "/crm/settings", surface: "portal", applies: !!l && l.clientTexting !== "none" },
  ];
  return items.filter((i) => i.applies).map(({ applies: _applies, ...i }) => i);
}

function recentFor(now: Date, scenario: DashboardFixtureScenario): DashboardRecentItem[] {
  if (scenario !== "full") return [
    { id: "n:sample-1", at: ago(now, 5 * 60_000), source: "notification", title: "Welcome to ConstructHUB", body: "Start with the checklist on your dashboard.", surface: "app", severity: "info", unread: true },
  ];
  return [
    { id: "n:sample-2", at: ago(now, 20 * 60_000), source: "notification", title: "New 5-star review", body: "A new review is waiting on a reply.", href: "/google-reviews", surface: "app", severity: "info", unread: true },
    { id: "c:sample-3", at: ago(now, 2 * HOUR), source: "crm", title: "A client approved (signed) estimate 1042", href: "/crm/estimates", surface: "portal", severity: "info" },
    { id: "n:sample-4", at: ago(now, 6 * HOUR), source: "notification", title: "Profile Guard caught an edit", body: "Someone suggested a new phone number for a location.", href: "/locations", surface: "app", severity: "warning", unread: true },
    { id: "c:sample-5", at: ago(now, DAY), source: "crm", title: "A client paid $2,400.00 by CARD", href: "/crm/payments", surface: "portal", severity: "info" },
    { id: "n:sample-6", at: ago(now, 2 * DAY), source: "notification", title: "Site Scan finished", body: "Score 82.", href: "/site-scan", surface: "app", severity: "info" },
  ];
}

export function buildDashboardFixture(
  scenario: DashboardFixtureScenario,
  user: { displayName?: string | null } = {},
  now = new Date(),
): DashboardPayload {
  const plan: PlanKey | null = scenario === "full" ? "growth" : scenario === "new" ? "starter" : null;
  const modules = NO_MODULES;
  const hasCrmOrg = scenario !== "noplan";
  const displayName = user.displayName?.trim() || null;
  const recent = recentFor(now, scenario);
  const account: DashboardAccount = {
    firstName: displayName ? displayName.split(/\s+/)[0] : null,
    displayName,
    plan,
    planName: plan ? PLANS[plan].name : null,
    status: plan ? (scenario === "new" ? "trialing" : "active") : "none",
    isPlatformAdmin: false,
    trialEndsAt: scenario === "new" ? new Date(now.getTime() + DAY).toISOString() : null,
    renewsAt: scenario === "full" ? new Date(now.getTime() + 17 * DAY).toISOString() : null,
    usage: usageFor(plan, scenario),
    resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    unreadNotifications: recent.filter((r) => r.unread).length,
  };
  const tiles = DASHBOARD_TILES.map((def) => tileFor(scenario, def, now, plan, modules, hasCrmOrg));
  return {
    generatedAt: now.toISOString(),
    cached: false,
    fixture: true,
    account,
    tiles,
    attention: dashboardAttention(tiles, account),
    cleared: [],
    layout: defaultDashboardLayout(),
    hiddenTiles: [],
    checklist: checklistFor(plan, scenario),
    recent,
  };
}

/**
 * The sample payload under a user's saved layout, so the Customize sheet can
 * be exercised against the sample scenarios too.
 */
export function applyLayoutToFixture(payload: DashboardPayload, layout: DashboardLayout): DashboardPayload {
  // As the real build does: hidden tiles leave the grid, their alerts stay.
  return {
    ...payload,
    ...splitDashboardTiles(payload.tiles, layout),
    attention: dashboardAttention(payload.tiles, payload.account),
    layout,
  };
}
