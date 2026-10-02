import type { FeaturePage } from "./types";
import { PLANS, planForModule } from "../plans";
import { plansWhere } from "../plan-copy";

/**
 * Search Console — half of the Agency-only "Cloudflare + Search Console" module.
 *
 * Every claim below is backed by the code in `sources`:
 *   - connect with Google (its own grant, webmasters scope, separate from GBP/Calendar): server/gsc/routes.ts
 *     /api/gsc/connect + /callback, server/gsc/service.ts saveGscGrant; page copy client/src/pages/site-connections.tsx
 *   - property discovery (owner / full / restricted), linked to locations by website: service.ts discoverProperties,
 *     server/cloudflare/common.ts mapLocations
 *   - sync: sitemaps + search analytics by date, query, page, device, country; default window ends 3 days ago;
 *     up to 16 months: service.ts syncProperty/analyticsPage, server/cloudflare/routes.ts /sync
 *   - analytics view: clicks, impressions, CTR, position, grouped by day/week/month, with Google's caveats:
 *     server/gsc/routes.ts GET /assets/:id/analytics
 *   - URL inspection (verdict + coverage state, inspected-URL coverage summary, does not request indexing),
 *     per-property daily/minute caps: routes.ts /urls + /inspections, service.ts inspectUrl
 *   - sitemap submission needs confirmation and full access: routes.ts POST /api/gsc/urls
 *   - location Insights card (last 30 days) and Site Scan indexing card: site-connections.tsx LocationSearchSummary,
 *     ScanIndexingSummary; client/src/pages/locations.tsx; client/src/pages/site-scan.tsx
 *   - client onboarding emails: server/cloudflare/routes.ts /invites, server/cloudflare/worker.ts deliverInvite
 *   - Agency-only gate: requireModule("cloudflareSearchConsole") in server/cloudflare/routes.ts registerAssetRoutes
 */

const MODULE_PLAN = PLANS[planForModule("cloudflareSearchConsole")].name;
const ONLY_PLAN = plansWhere((plan) => plan.modules.cloudflareSearchConsole).length === 1;

const page: FeaturePage = {
  key: "searchConsole",
  slug: "search-console",
  group: "protect",
  status: "ready",
  title: "Search Console",
  kicker: "Google search data",
  headline: { lead: "Search Clicks and Indexing for ", swipe: "Every Property" },
  lede:
    "Connect the Google accounts that hold your Search Console properties. Sync clicks, impressions, click-through rate " +
    "and position by query, page, device and country, check how Google sees a URL, and submit sitemaps.",
  hero: { mascot: "gabe", bubble: "Let's see what people search to find you." },
  steps: [
    {
      title: "Connect a Google account",
      body: "Sign in with the Google account that can open your Search Console properties. This permission is kept separate from your Business Profile connection.",
    },
    {
      title: "Your properties are found",
      body: "Every property the account can open is listed, and linked to the location with the same website.",
    },
    {
      title: "Sync search data",
      body: "Pick properties and a date range up to 16 months back. Sitemaps and search performance sync in the background.",
    },
    {
      title: "Inspect and submit",
      body: "Queue URL inspections to see Google's indexing verdict, and submit sitemaps once you confirm.",
    },
  ],
  cards: [
    {
      icon: "search",
      title: "Search performance",
      body: "Clicks, impressions, click-through rate and average position by date, query, page, device or country, grouped by day, week or month.",
    },
    {
      icon: "eye",
      title: "URL inspection",
      body: "Google's index verdict and coverage state for each URL you inspect, and a summary across the URLs inspected so far.",
    },
    {
      icon: "send",
      title: "Sitemaps",
      body: "See the sitemaps Google has for a property and submit new ones. Submitting needs full access and your confirmation.",
    },
    {
      icon: "map-pin",
      title: "On each location",
      body: "A location's Insights tab shows its property's clicks and impressions for the last 30 days.",
    },
    {
      icon: "gauge",
      title: "Next to Site Scan",
      body: "A Site Scan report shows the latest inspection result for each page it scanned.",
    },
    {
      icon: "mail",
      title: "Client onboarding",
      body: "Email a client the steps to add your Google account as a user on their property. The property shows up once access is granted.",
    },
  ],
  audience: [
    {
      title: "Agencies reporting on client search",
      body: "Every client property in one list, synced in bulk, with clicks and queries ready to read.",
    },
    {
      title: "Multi-location companies",
      body: "See each location's search clicks and impressions right on its location page.",
    },
    {
      title: "Teams fixing indexing",
      body: "Check whether Google has indexed the pages Site Scan found, then submit the sitemap.",
    },
  ],
  pricing: {
    kind: "module",
    module: "cloudflareSearchConsole",
    note: "Cloudflare is included alongside it, at no extra cost.",
  },
  faqs: [
    {
      q: "What do I need to connect it?",
      a: "A Google account that already has access to the property in Search Console. ConstructHUB doesn't verify a website in Search Console for you. Viewing works with restricted access; submitting sitemaps needs full or owner access.",
    },
    {
      q: "Which plan includes it?",
      a: `Search Console comes with the ${MODULE_PLAN} plan, together with Cloudflare.${ONLY_PLAN ? " No other plan includes it." : ""}`,
    },
    {
      q: "Will it get my pages indexed?",
      a: "No. Inspection reads Google's current verdict and doesn't request indexing, and submitting a sitemap tells Google where it is. Google decides what to index.",
    },
    {
      q: "How fresh is the data?",
      a: "Google reports search data with a delay, returns the top rows and leaves out some anonymised queries, so a sync stops a few days short of today by default. Syncs run in the background.",
    },
    {
      q: "Is there a limit on inspections?",
      a: "Yes. Google limits URL inspections per property each day and each minute, and ConstructHUB stops before reaching that limit. Background work is also capped per hour.",
    },
  ],
  related: ["siteScan", "cloudflare", "gbp"],
  app: { href: "/search-console", surface: "app" },
  headings: {
    cards: { title: "What It ", em: "Shows You" },
  },
  seo: {
    title: "Search Console — Clicks, Queries and Indexing | ConstructHUB",
    description:
      "Sync Google Search Console clicks, impressions, CTR and position by query, page, device and country, inspect URLs and submit sitemaps for each property.",
  },
  sources: [
    "client/src/pages/site-connections.tsx",
    "client/src/pages/locations.tsx",
    "client/src/pages/site-scan.tsx",
    "server/gsc/routes.ts",
    "server/gsc/service.ts",
    "server/gsc/client.ts",
    "server/cloudflare/routes.ts",
    "server/cloudflare/common.ts",
    "server/cloudflare/worker.ts",
    "shared/plans.ts",
  ],
};

export default page;
