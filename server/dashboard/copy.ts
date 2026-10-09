/**
 * Server-side copy for dashboard tiles: setup calls to action and the
 * standard sentences for the non-"ok" states. Shared by the aggregator and the
 * sample payloads (fixture.ts) so both read the same.
 */
import { PLANS, CALL_ASSISTANT_PRICING_HREF, type PlanKey } from "@shared/plans";
import { CALL_ASSISTANT_SEPARATE_LINE } from "@shared/plan-copy";
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

/**
 * The AI Call Assistant is a separate service on its own subscription (shared/plans.ts,
 * owner 2026-10-08): its lock names no plan and its way forward is its own pricing section.
 */
export const SEPARATE_SERVICE_MESSAGE = CALL_ASSISTANT_SEPARATE_LINE;
export const SEPARATE_SERVICE_CTA = { label: "See Call Assistant pricing", href: CALL_ASSISTANT_PRICING_HREF, surface: "app" as const };

export const lockedMessage = (plan: PlanKey | undefined, addon?: string) =>
  addon ? SEPARATE_SERVICE_MESSAGE : `Included with the ${plan ? PLANS[plan].name : "a paid"} plan.`;

export const COMING_SOON_MESSAGE = "Coming soon: a separate service with its own subscription.";

export const timeoutMessage = (title: string) => `${title} didn't answer in time. Open the page for live numbers.`;
export const failedMessage = (title: string) => `${title} couldn't load its numbers right now. Open the page for live numbers.`;
