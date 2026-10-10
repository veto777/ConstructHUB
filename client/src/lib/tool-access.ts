/**
 * Which tools the signed-in account HAS — the sidebar shows those and moves
 * the rest into a locked "More tools" group whose entries open the tool's
 * landing page (owner, 2026-10-10: "after a subscription is chosen … the side
 * bar will have only the service activated that's purchased. All other
 * services have a nice landing page that advertises that feature"). The same
 * rules gate the routes (components/tool-route-gate.tsx): a signed-in account
 * that lacks a tool and lands on its URL gets the landing page.
 *
 * Every rule mirrors a server gate (server/entitlements.ts requirePlan /
 * requireModule / the allowance tests) on GET /api/entitlements, which already
 * carries the plan's allowances and modules with the à la carte items laid
 * over them (shared/alacarte.ts) — so a tool bought on its own unlocks exactly
 * as one that came with a plan. Pure: server/tool-access.test.ts drives it.
 *
 * Never a lock the server would not enforce: an account acting in someone
 * else's agency workspace works under that owner's plan, which this check
 * can't see, so it sees everything; a loading or failed /api/entitlements is
 * "unknown" and shows everything rather than a wrong lock; platform admins
 * see everything.
 */
import type { EntitlementsInfo } from "./pricing-display";

export type ToolAccessContext = {
  /** GET /api/entitlements; undefined while loading or after a failure. */
  entitlements: EntitlementsInfo | null | undefined;
  /** GET /api/agency/me: acting in another owner's workspace (owner !== actor). */
  agencyMember: boolean;
  /** GET /api/agency/me teamEntitled: the agency workspace for this actor; undefined while loading. */
  agencyWorkspace: boolean | undefined;
  /** GET /api/crm/billing/subscription access.active: the account's own CRM plan; undefined while loading. */
  crmActive: boolean | undefined;
};

export type ToolAccess = "has" | "locked" | "unknown";

type Rule = {
  /** The landing page a locked entry opens (/features/<slug>, or a page of its own). */
  landing: string;
  /** True = has it; false = lacks it; undefined = can't tell yet. */
  has: (ent: EntitlementsInfo, ctx: ToolAccessContext) => boolean | undefined;
};

const count = (ent: EntitlementsInfo, limit: keyof NonNullable<EntitlementsInfo["allowances"]>) => {
  const v = ent.allowances?.[limit];
  return typeof v === "number" ? v !== 0 : false;
};
const module = (ent: EntitlementsInfo, key: keyof EntitlementsInfo["modules"]) => ent.modules?.[key] === true;

/**
 * Tool URL → the gate and the landing page. A URL with no rule is always
 * shown (free pages: the database directory, the guides, LSA Leads, the
 * tutorials, Pricing). Keep the landing pages in step with shared/feature-pages.
 */
export const TOOL_RULES: Record<string, Rule> = {
  // Permits & databases
  "/search": { landing: "/features/permits", has: (e) => count(e, "permitSearches") },
  "/schedules": { landing: "/features/permits", has: (e) => count(e, "permitSearches") },
  "/history": { landing: "/features/permits", has: (e) => count(e, "permitSearches") },
  "/property": { landing: "/features/property", has: (e) => module(e, "propertyRecords") },
  // Google Business
  "/google-profile": { landing: "/features/gbp", has: (e) => count(e, "locations") },
  "/locations": { landing: "/features/gbp", has: (e) => count(e, "locations") },
  "/listing-editor": { landing: "/features/gbp", has: (e) => count(e, "locations") },
  "/gmb-monitor": { landing: "/features/profile-guard", has: (e) => count(e, "locations") },
  "/gbp-content": { landing: "/features/gbp-content", has: (e) => count(e, "locations") || module(e, "autoPosts") },
  "/photos": { landing: "/features/media", has: (e) => count(e, "locations") },
  "/media-library": { landing: "/features/media", has: (e) => count(e, "locations") },
  "/ranking-grid": { landing: "/features/ranking-grid", has: (e) => count(e, "gridCredits") },
  "/agency": { landing: "/features/agency", has: (_e, ctx) => ctx.agencyWorkspace },
  "/domains": { landing: "/features/domains", has: (e) => module(e, "domainsMailAlerts") },
  "/mail-alerts": { landing: "/features/mail-alerts", has: (e) => module(e, "domainsMailAlerts") },
  "/google-reviews": { landing: "/features/reviews", has: (e) => count(e, "locations") || module(e, "reviewReminders") },
  // Google Ads
  "/ads-manager": { landing: "/features/ads-manager", has: (e) => module(e, "adsManager") },
  "/google-ads": { landing: "/features/click-guard", has: (e) => count(e, "protectedSites") },
  "/ip-tracker": { landing: "/features/ip-tracker", has: (e) => count(e, "protectedSites") },
  "/vpn-shield": { landing: "/features/vpn-shield", has: (e) => count(e, "protectedSites") },
  // Tools
  "/call-assistant": { landing: "/call-assistant", has: (e) => e.addonModules?.callAssistant === true || e.addonModulesPaused?.callAssistant === true },
  "/social-media": { landing: "/features/social", has: (e) => module(e, "socialPublishing") },
  "/site-scan": { landing: "/features/site-scan", has: (e) => count(e, "siteScans") },
  "/seo": { landing: "/features/seo", has: (e) => count(e, "seoKeywords") },
  "/cloudflare": { landing: "/features/cloudflare", has: (e) => module(e, "cloudflareSearchConsole") },
  "/search-console": { landing: "/features/search-console", has: (e) => module(e, "cloudflareSearchConsole") },
  "/competitors": { landing: "/features/competitors", has: (e) => count(e, "competitorScans") },
  // The CRM: its own subscription (the gateway page sorts out crew seats in someone else's org).
  "/crm-app": { landing: "/features/crm", has: (_e, ctx) => ctx.crmActive },
};

/** The rule a URL falls under: exact, or the /seo/* pages under /seo. */
export function toolRuleFor(url: string): Rule | undefined {
  const path = url.split(/[?#]/)[0];
  if (TOOL_RULES[path]) return TOOL_RULES[path];
  if (path.startsWith("/seo/")) return TOOL_RULES["/seo"];
  return undefined;
}

/** Has the account this tool? "unknown" shows the tool as before (never a wrong lock). */
export function toolAccess(url: string, ctx: ToolAccessContext): ToolAccess {
  const rule = toolRuleFor(url);
  if (!rule) return "has";
  const ent = ctx.entitlements;
  if (!ent) return "unknown";
  if (ent.isPlatformAdmin) return "has";
  // A member of another owner's workspace works under that plan: every platform tool stays open. The CRM is
  // its own subscription, decided separately.
  if (ctx.agencyMember && rule !== TOOL_RULES["/crm-app"]) return "has";
  const has = rule.has(ent, ctx);
  if (has === undefined) return "unknown";
  return has ? "has" : "locked";
}

/** Where a locked entry goes: the tool's landing page (the tool itself has no rule). */
export const lockedLanding = (url: string): string => toolRuleFor(url)?.landing ?? url;

/** The /features page a locked route should render, as its slug; null when the landing is a page of its own. */
export function lockedFeatureSlug(url: string): string | null {
  const landing = toolRuleFor(url)?.landing;
  const m = landing ? /^\/features\/([a-z0-9-]+)$/.exec(landing) : null;
  return m ? m[1] : null;
}
