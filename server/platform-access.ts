/**
 * The API paywall (owner, 2026-10-16: "make sure we don't allow anyone to scrape our site or use cookies to access
 * data or our features" · "they are not even supposed to see the features … until the account is at least at trial
 * phase"). The client hides the app from an account with nothing on the platform (components/platform-plan-gate.tsx,
 * lib/tool-access.ts hasAnyAccess); this is the same rule on the server, so a session cookie alone opens nothing.
 *
 *   platformAccessGate     mounted on every request before the routers: a SIGNED-IN account with no platform access
 *                          gets the plan_required 402 (sendPlanRequired) on every /api path that is not on
 *                          OPEN_WITHOUT_PLAN. A request with no session is left alone (each route's own auth applies).
 *   requirePlatformAccess  for routes that used to answer signed-out visitors (the permit directory, the photo and
 *                          AI tools): 401 without a session, then the same 402.
 *   hasPlatformAccess      the decision, pure (server/platform-access.test.ts).
 *   isOpenWithoutPlan      the allow-list check, pure.
 *
 * "Has access" mirrors hasAnyAccess: a platform admin, a plan (a trial counts), a plan paused for a payment (so the
 * owner can reach Billing and fix the card), an à la carte item in force, the Call Assistant (running or paused),
 * the CRM, or a seat in another owner's agency workspace whose plan includes the team. The answer is cached per
 * account for 30 s (server/platform-access-cache.ts); billing changes forget it at once.
 */
import type { Request, Response, NextFunction } from "express";
import { PAYMENT_NEEDED_STATUSES, PLAN_KEYS } from "@shared/plans";
import { getEntitlements, sendPlanRequired, type Entitlements } from "./entitlements";
import { cachedPlatformAccess, rememberPlatformAccess } from "./platform-access-cache";
import { logError } from "./ops/log";

export { forgetPlatformAccess, PLATFORM_ACCESS_TTL_MS } from "./platform-access-cache";

/** The slice of the entitlements the decision reads. */
export type PlatformAccessEntitlements = Pick<Entitlements,
  "isPlatformAdmin" | "plan" | "accessPlan" | "subscriptionStatus" | "alacarte" | "addonModules" | "addonModulesPaused">;

/** Does the account's own platform record give it anything (no CRM or agency lookups)? Pure. */
export function ownPlatformAccess(ent: PlatformAccessEntitlements): boolean {
  if (ent.isPlatformAdmin || ent.plan || ent.accessPlan) return true;
  if (PAYMENT_NEEDED_STATUSES.includes(ent.subscriptionStatus ?? "")) return true;
  if ((ent.alacarte?.active?.length ?? 0) > 0) return true;
  return ent.addonModules?.callAssistant === true || ent.addonModulesPaused?.callAssistant === true;
}

/** The whole decision. Pure: the loader feeds it the CRM and agency answers. */
export function hasPlatformAccess(input: { ent: PlatformAccessEntitlements; crmActive: boolean; agencySeat: boolean }): boolean {
  return ownPlatformAccess(input.ent) || input.crmActive || input.agencySeat;
}

/**
 * /api paths an account with no platform access may still use, as path prefixes (a prefix matches itself and
 * anything under it, never a longer sibling: "/api/review" does not open "/api/reviews"). Read from the routes
 * themselves; every one is a sign-in, buying, account, help or public-link path, never a tool.
 */
export const OPEN_WITHOUT_PLAN: readonly string[] = [
  // Signing in and out, sign-up, 2FA, devices, re-auth, the profile; what the account has.
  "/api/auth", "/api/entitlements",
  // Buying: plans and the cart (checkout, portal, change plan, add-ons, the webhook), à la carte, the Call
  // Assistant's own subscription, invoices and payment methods, the founding offer, the trial-code invite.
  "/api/stripe", "/api/alacarte", "/api/call-assistant/billing", "/api/billing", "/api/pricing",
  "/api/beta-codes/redeem", "/api/beta-codes/status",
  // The CRM is its own product with its own gate (server/crm/*).
  "/api/crm",
  // Finding and opening a workspace someone shared (agency/routes.ts /me and /workspace answer without a plan).
  "/api/agency/me", "/api/agency/workspace",
  // The account itself: settings, UI prefs, API keys, deletion; its security log; notifications.
  "/api/account", "/api/account-activity", "/api/notifications", "/api/notification-prefs",
  // Help: Hub, the Google Ads consultant chat, error reports, the issue desk, the support line, contact forms.
  "/api/hub", "/api/ads-consultant", "/api/ops/client-error", "/api/issues", "/api/support", "/api/reinstatement",
  "/api/seo-inquiry",
  // Analytics beacons and the public site config.
  "/api/analytics", "/api/ads-lp", "/api/public-config",
  // The Master Class (sold on its own; /master-class is open without a plan), the guides and tutorial media.
  "/api/master-class", "/api/master-class-modules", "/api/course-catalog", "/api/course-access", "/api/course-purchases",
  "/api/state-guides", "/api/google-ads-guide", "/api/tutorials/media", "/api/files",
  // Public figures the marketing pages show.
  "/api/databases/counts", "/api/research-reports/coverage-facets", "/api/research-reports/coverage-runtime",
  // Links a contractor's customer opens (signed in or not): estimates, invoices, change orders, lead forms, the
  // portal, review requests, JobCam shares, the client portal, agency onboarding, shared and free Site Scans,
  // report emails, social media handed to the networks.
  "/api/public", "/api/review", "/api/jc", "/api/client", "/api/agency-onboarding", "/api/sitescan/public",
  "/api/sitescan/shared", "/api/seo/report-unsubscribe", "/api/seo/report-confirm", "/api/seo/report-refuse",
  // The scripts a customer's website runs (Click Guard, VPN Shield).
  "/api/click-guard/track", "/api/click-guard/script", "/api/click-guard/exclusion-list", "/api/vpn-shield/track",
  "/api/vpn-shield/script",
  // Webhooks and machine callers (their own signatures/tokens), the public and Code APIs (their own keys).
  // The social networks' deletion callbacks and the /data-deletion page's status check (social/deletion.ts).
  "/api/inbound-mail", "/api/social/outstand/webhook", "/api/social/native/tiktok/webhook", "/api/social/native/data-deletion",
  "/api/social/native/instagram/data-deletion", "/api/social/native/instagram/deauthorize", "/api/social/native/meta",
  "/api/social/native/threads/delete", "/api/social/native/threads/uninstall",
  "/api/social/bluesky/client-metadata.json", "/api/social/bluesky/jwks.json", "/api/lsa/telegram/webhook",
  "/api/voice", "/api/voice-ingest", "/api/voice-internal", "/api/laml", "/api/ops-internal", "/api/ci",
  "/api/app/push-token", "/api/v1", "/api/dev",
];

/** A contract a customer signs by link: /api/contracts/:token, …/sign, …/checkout (never /create or /user/list). */
const CONTRACT_LINK = /^\/api\/contracts\/(?!create$|user$)[^/]+(?:\/(?:sign|checkout))?$/;

/**
 * Is this path open to an account with no platform access? Express matches routes case-insensitively and with an
 * optional trailing slash, so the check does too. Anything unusual (an encoded character in a prefix) is simply not
 * on the list: the gate fails closed.
 */
export function isOpenWithoutPlan(rawPath: string): boolean {
  let path = rawPath.toLowerCase();
  while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (!path.startsWith("/api/")) return true;
  if (CONTRACT_LINK.test(path)) return true;
  return OPEN_WITHOUT_PLAN.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Seats in other owners' workspaces whose plan includes the team (agency/access.ts teamEntitled). */
async function agencySeat(userId: number): Promise<boolean> {
  try {
    const { pool } = await import("./db");
    const { teamEntitled } = await import("./agency/access");
    const { rows } = await pool.query("SELECT user_id FROM agency_members WHERE member_id=$1 AND user_id<>$1 ORDER BY user_id LIMIT 20", [userId]);
    for (const r of rows) if (await teamEntitled(Number(r.user_id), userId)) return true;
    return false;
  } catch (err) {
    // No agency tables (a fresh database) means no seats.
    if ((err as { code?: string })?.code === "42P01") return false;
    throw err;
  }
}

async function crmActive(userId: number): Promise<boolean> {
  const { getCrmEntitlements } = await import("./crm/entitlements");
  return (await getCrmEntitlements(userId)).active;
}

/** The account's answer, from the cache or decided now (cheapest checks first). */
export async function platformAccessFor(userId: number): Promise<boolean> {
  const cached = cachedPlatformAccess(userId);
  if (cached !== undefined) return cached;
  const ent = await getEntitlements(userId);
  const has = ownPlatformAccess(ent) || await crmActive(userId) || await agencySeat(userId);
  rememberPlatformAccess(userId, has);
  return has;
}

/** The 402 for an account with nothing on the platform: the plan_required body, pointed at Pricing. */
export function sendNoPlatformAccess(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  return sendPlanRequired(res, PLAN_KEYS[0], "This tool", {
    message: "Choose a plan to start your trial. Your tools open as soon as it starts.",
    href: "/pricing",
  });
}

const sessionUserId = (req: Request): number | null => {
  const id = (req as any).user?.id;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
};

/** Global: signed-in accounts with no platform access reach only OPEN_WITHOUT_PLAN. */
export async function platformAccessGate(req: Request, res: Response, next: NextFunction) {
  const userId = sessionUserId(req);
  if (userId === null || isOpenWithoutPlan(req.path)) return next();
  try {
    if (await platformAccessFor(userId)) return next();
    sendNoPlatformAccess(res);
  } catch (err) {
    logError("Platform access check failed:", err);
    if (!res.headersSent) res.status(500).json({ message: "Could not check your plan. Please try again." });
  }
}

/** Per-route: a signed-in account with platform access, or 401 / 402. */
export async function requirePlatformAccess(req: Request, res: Response, next: NextFunction) {
  const userId = sessionUserId(req);
  if (userId === null) return void res.status(401).json({ message: "Sign in to use this." });
  try {
    if (await platformAccessFor(userId)) return next();
    sendNoPlatformAccess(res);
  } catch (err) {
    logError("Platform access check failed:", err);
    if (!res.headersSent) res.status(500).json({ message: "Could not check your plan. Please try again." });
  }
}
