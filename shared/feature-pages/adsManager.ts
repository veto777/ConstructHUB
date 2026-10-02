import type { FeaturePage } from "./types";
import { planNamesWhere } from "../plan-copy";

/**
 * Agency Ads & LSA — the Google Ads manager for agencies (/ads-manager).
 *
 * Scope note: /lsa-account-manager is a PLATFORM-ADMIN console (server/routes.ts adminGuard on every
 * /api/admin/lsa/* route), and the Google Ads guide (/google-ads-guide) is unlocked by a course purchase
 * (server/routes.ts GET /api/google-ads-guide/:slug) and belongs to the Guides page. Neither is sold here.
 *
 * Every claim below is backed by the code in `sources`:
 *   - connect an MCC with Google sign-in (adwords scope), discover client accounts, the "owner setup required"
 *     message when the Ads connection isn't configured: server/ads/routes.ts /connect /callback /status,
 *     client/src/pages/ads-manager.tsx
 *   - client list (status, currency, timezone, LSA identified / not found / not checked, search + filters):
 *     server/ads/routes.ts GET /accounts, client/src/pages/ads-manager.tsx
 *   - bulk access requests (customer ID,email pairs, up to 1,000), Google manager invitation + instruction email,
 *     cancel pending, clients can decline: server/ads/routes.ts /invitations, server/ads/worker.ts
 *   - health audit checks (last 30 days where dated, "unavailable" is never a pass, a fix per finding):
 *     server/ads/audit.ts; batches of 1–1,000 accounts: server/ads/routes.ts targets()
 *   - protections (presence-only, Click Guard IP exclusions with rotation, shared negatives, account-wide
 *     placements, ad schedule), per-account previews, confirm checkbox, expiry, re-check before writing,
 *     reversal preview: server/ads/protections.ts, server/ads/worker.ts, client/src/pages/ads-manager.tsx
 *   - Agency-only module: server/ads/routes.ts requireModule('adsManager'), shared/plans.ts modules
 */

const PLAN_NAMES = planNamesWhere((plan) => plan.modules.adsManager);

const page: FeaturePage = {
  key: "adsManager",
  slug: "ads-manager",
  group: "win",
  status: "ready",
  title: "Agency Ads & LSA",
  kicker: "For agencies",
  headline: { lead: "Audit and Protect Client Ad Accounts ", swipe: "in\u00a0Bulk" },
  lede:
    "Connect your Google Ads manager account, request access to client accounts, run a health audit across them, " +
    "and preview protections like presence-only targeting and negative keywords before anything changes in Google.",
  hero: { mascot: "standing", bubble: "Let's look over every client account at once." },
  steps: [
    {
      title: "Connect your MCC",
      body: "Sign in with Google and connect your Google Ads manager account. ConstructHUB then finds the client accounts under it.",
    },
    {
      title: "Request client access",
      body: "Paste customer ID and email pairs and review the list. Each client gets a Google manager invitation and an email on how to accept it.",
    },
    {
      title: "Run a health audit",
      body: "Queue an audit for the clients you pick. Each account gets its findings, and each finding comes with a way to fix it.",
    },
    {
      title: "Preview, then confirm",
      body: "Choose a protection and review each account's own preview of every change before you confirm it.",
    },
  ],
  cards: [
    {
      icon: "users",
      title: "Every client in one list",
      body: "Each client under your MCC with its status, currency, timezone and whether Local Services campaigns were found. Search and filter the list.",
    },
    {
      icon: "send",
      title: "Access requests in bulk",
      body: "Request access to up to 1,000 clients at a time. Clients can decline, and you can cancel any invitation that's still pending.",
    },
    {
      icon: "clipboard",
      title: "Health audit",
      body: "Conversion and call tracking, budget-limited campaigns, search terms with spend and no conversions, disapproved ads, location targeting and ad schedules.",
    },
    {
      icon: "map-pin",
      title: "Local Services checks",
      body: "For LSA campaigns: service areas, job types and budget, plus charged leads that may still need your feedback, linked to LSA Leads.",
    },
    {
      icon: "shield-check",
      title: "Protections, previewed",
      body: "Presence-only location targeting, shared negative keywords, account-wide placement exclusions, ad schedules and Click Guard IP exclusions.",
    },
    {
      icon: "refresh",
      title: "Careful with every write",
      body: "Previews expire, each account is re-checked before anything is written, and an applied change can be reversed through its own preview.",
    },
  ],
  spotlight: {
    kicker: "The Audit",
    heading: { title: "What a Health Audit ", em: "Looks\u00a0At" },
    points: [
      "Budget, search-term and charged-lead checks cover the last 30 days.",
      "When Google doesn't return a check, it shows as unavailable, never as a pass.",
      "Each finding links to its fix: a protection preview here, or the right place in Google Ads.",
      "The audit only reads. It never changes a campaign by itself.",
    ],
    panel: {
      label: "Health audit",
      title: "Checks on every account",
      items: [
        "Conversion actions", "Call conversion actions", "Budget-limited campaigns", "Search terms with no conversions",
        "Disapproved ads", "Presence-only targeting", "Ad schedules", "LSA service areas", "LSA job types", "LSA budget",
        "Charged leads to review",
      ],
      note: "Queue it for up to 1,000 client accounts at a time.",
    },
  },
  audience: [
    {
      title: "Agencies running contractor ads",
      body: "Work through every client under your MCC instead of opening accounts one at a time.",
    },
    {
      title: "Agencies managing Local Services",
      body: "See which clients run LSA campaigns and what their setup may be missing.",
    },
    {
      title: "Teams that want a review step",
      body: "Every change starts as a preview, so someone can check it before it reaches Google.",
    },
  ],
  pricing: { kind: "module", module: "adsManager" },
  faqs: [
    {
      q: "What does it need from me?",
      a: "A Google Ads manager (MCC) account and a Google sign-in that can manage it. Client accounts show up once they're linked to your MCC, so clients need to accept your invitation first. If the Google Ads connection isn't switched on for ConstructHUB yet, the page tells you so.",
    },
    {
      q: "Which plan includes it?",
      a: `It's part of the ${PLAN_NAMES} plan; no other plan includes it.`,
    },
    {
      q: "Will it change my clients' campaigns on its own?",
      a: "No. Audits only read. A protection is built as a preview for each account, and nothing is written to Google until you tick the review box and confirm. If the account changed after the preview, nothing is written and you prepare a new one.",
    },
    {
      q: "Does it build or manage campaigns for me?",
      a: "No. It doesn't create campaigns, write ads, or change bids or budgets. It audits accounts and applies only the protections you preview and confirm.",
    },
    {
      q: "How does it work with Click Guard?",
      a: "Map each client account to its Click Guard website. The IP exclusion protection then uses that site's newest flagged IPs, rotating out the oldest exclusions to stay inside Google's limit for each campaign.",
    },
  ],
  related: ["clickGuard", "lsaLeads", "agency"],
  app: { href: "/ads-manager", surface: "app" },
  headings: {
    steps: { title: "From MCC to Protected Accounts in ", em: "Four\u00a0Steps" },
    cards: { title: "What the Manager ", em: "Gives You" },
  },
  seo: {
    title: "Agency Ads & LSA Manager for Google Ads | ConstructHUB",
    description:
      "Connect your Google Ads MCC, request client access in bulk, audit client accounts and preview protections like presence-only targeting before anything changes.",
  },
  sources: [
    "client/src/pages/ads-manager.tsx",
    "server/ads/routes.ts",
    "server/ads/audit.ts",
    "server/ads/protections.ts",
    "server/ads/worker.ts",
    "server/ads/client.ts",
    "server/entitlements.ts",
    "shared/plans.ts",
  ],
};

export default page;
