/**
 * Server-side copy for dashboard tiles: setup calls to action and the
 * standard sentences for the non-"ok" states. Shared by the aggregator and the
 * sample payloads (fixture.ts) so both read the same.
 */
import { PLANS, type PlanKey } from "@shared/plans";
import type { DashboardTileKey } from "@shared/dashboard";

/** The setup call to action on an "empty" tile. */
export const CTA_START: Partial<Record<DashboardTileKey, string>> = {
  gbp: "Connect Google", reviews: "Send a review request", profileGuard: "Turn on Profile Guard", rankingGrid: "Run a grid",
  gbpContent: "Schedule a post", social: "Connect social accounts", siteScan: "Run a Site Scan", media: "Upload photos",
  clickGuard: "Protect a website", ipTracker: "Add the tracking script", vpnShield: "Turn on VPN Shield", cloudflare: "Connect Cloudflare",
  searchConsole: "Connect Search Console", domains: "Connect a registrar", mailAlerts: "Get your forwarding address",
  permits: "Search permits", competitors: "Run a scan", adsManager: "Connect Google Ads", lsaLeads: "Connect LSA",
  crm: "Open the CRM", crmSchedule: "Book a visit", crmLeads: "Add a lead", texting: "Set up texting", agency: "Add a client",
  masterClass: "Start learning",
};

export const lockedMessage = (plan: PlanKey | undefined) =>
  `Included with the ${plan ? PLANS[plan].name : "a paid"} plan.`;

export const COMING_SOON_MESSAGE = "Coming soon as an add-on for the Pro, Growth and Agency plans.";

export const timeoutMessage = (title: string) => `${title} didn't answer in time. Open the page for live numbers.`;
export const failedMessage = (title: string) => `${title} couldn't load its numbers right now. Open the page for live numbers.`;
