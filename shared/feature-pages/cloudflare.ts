import type { FeaturePage } from "./types";
import { PLANS, planForModule } from "../plans";
import { plansWhere } from "../plan-copy";

/**
 * Cloudflare — half of the Agency-only "Cloudflare + Search Console" module.
 *
 * Every claim below is backed by the code in `sources`:
 *   - connect: Global API key exchanged for a created token (Zone Read, Analytics Read, Zone WAF Edit) on chosen
 *     zones, key never stored; or paste a scoped token: server/cloudflare/routes.ts (/key-discovery, /exchange,
 *     /token), server/cloudflare/service.ts exchangeKey, server/cloudflare/client.ts ZONE_PERMISSIONS
 *   - zone discovery, linked to locations by website: server/cloudflare/service.ts discoverZones, common.ts mapLocations
 *   - analytics (last day: requests, uniques, page views, threats by day and country; latest 100 firewall events;
 *     top 20 paths; bot scores on eligible plans; sampled): server/cloudflare/service.ts cloudflareAnalytics
 *   - rule packs (ads door, bad user agents + flood limit, flagged IPs 1–100, office exemptions): service.ts rulePack
 *   - preview → confirm within an hour (recent sign-in) → undo; edge audit: server/cloudflare/routes.ts
 *     /preview, /confirm, /undo, /actions; service.ts applyAction
 *   - Click Guard's blocked IPs listed per zone, never published automatically: server/cloudflare/hooks.ts
 *   - disconnect deletes local data and the created token; applied rules remain: routes.ts /disconnect
 *   - background work, hourly budget, paused without the module: server/cloudflare/worker.ts, common.ts budget
 *   - Agency-only gate: requireModule("cloudflareSearchConsole") in routes.ts
 */

const MODULE_PLAN = PLANS[planForModule("cloudflareSearchConsole")].name;
const ONLY_PLAN = plansWhere((plan) => plan.modules.cloudflareSearchConsole).length === 1;

const page: FeaturePage = {
  key: "cloudflare",
  slug: "cloudflare",
  group: "protect",
  status: "ready",
  title: "Cloudflare",
  kicker: "Edge protection",
  headline: { lead: "Cloudflare Traffic and Firewall Rules, ", swipe: "Reviewed First" },
  lede:
    "Connect the Cloudflare accounts behind your and your clients' websites, see each zone's traffic and firewall " +
    "events, and apply ready-made protection rules after you've seen exactly what will change.",
  hero: { mascot: "standing", bubble: "Let's put a few rules at the front door." },
  steps: [
    {
      title: "Connect Cloudflare",
      body: "Use a Cloudflare login email and Global API key once to create a limited key for the zones you pick, or paste a scoped API token instead.",
    },
    {
      title: "Sync your zones",
      body: "Each zone is found, linked to the location with the same website, and synced with the last day of traffic, firewall events and top paths.",
    },
    {
      title: "Preview a rule pack",
      body: "Pick zones and a pack: an ads door for your ads landing page, a site-wide bad user agent pack, or a block list of flagged IPs.",
    },
    {
      title: "Confirm, or undo later",
      body: "Confirm within an hour of the preview and the rules are queued to Cloudflare. Every change stays in the edge audit, ready to undo.",
    },
  ],
  cards: [
    {
      icon: "key",
      title: "A limited key, not your login",
      body: "The key it creates has Zone Read, Analytics Read and Zone WAF Edit on the zones you chose. The Global API key is used for that one request and never stored.",
    },
    {
      icon: "chart",
      title: "Traffic and threats",
      body: "Requests, unique visitors, page views and threats for each day, broken down by country, from Cloudflare's analytics.",
    },
    {
      icon: "list",
      title: "Firewall events and top paths",
      body: "The latest 100 firewall events and the 20 most requested paths from the last day.",
    },
    {
      icon: "target",
      title: "Ads door",
      body: "On your ads landing path, blocks requests without a Google click ID, verified bots that aren't Google, and fast repeat requests from one IP.",
    },
    {
      icon: "shield",
      title: "Bad user agents and floods",
      body: "Site-wide, blocks empty and known scanner user agents, and briefly blocks any IP sending more than 120 requests in 10 seconds.",
    },
    {
      icon: "shield-alert",
      title: "Block flagged IPs",
      body: "Turn up to 100 IP addresses into a Cloudflare block rule. Each zone lists the IPs Click Guard blocked for its domain, so you can pick from them.",
    },
  ],
  spotlight: {
    kicker: "Before Anything Changes",
    heading: { title: "You See the Rules ", em: "Before Cloudflare Does" },
    points: [
      "The preview shows each rule's description and the exact expression it will add.",
      "Office IP exemptions are written into every rule in the pack.",
      "Confirming asks you to have signed in recently, and a preview expires after an hour.",
      "Click Guard findings are listed for you to choose from; they are never published on their own.",
      "Undo removes the rules ConstructHUB added, and nothing else.",
    ],
    panel: {
      label: "The rule preview",
      title: "What every preview shows",
      items: ["Zone", "Rule description", "Rule expression", "Office IP exemptions", "Warning", "Status in the edge audit"],
      note: "Some rules, like rate limiting, depend on what your Cloudflare plan allows.",
    },
  },
  audience: [
    {
      title: "Agencies with client sites on Cloudflare",
      body: "See every client zone's traffic and firewall events in one place, and roll out the same protection to many zones at once.",
    },
    {
      title: "Teams sending Google Ads to a landing page",
      body: "Guard the ads path with click ID checks and a rate limit at the edge, without writing firewall expressions.",
    },
    {
      title: "Anyone already using Click Guard",
      body: "Move the IPs Click Guard blocked from a Google Ads exclusion list into a firewall rule for the whole site.",
    },
  ],
  pricing: {
    kind: "module",
    module: "cloudflareSearchConsole",
    note: "Search Console is included alongside it, at no extra cost.",
  },
  faqs: [
    {
      q: "What do I need to connect it?",
      a: "A Cloudflare account with the website's zone on it, and either your Global API key to create a limited key or a scoped API token you make yourself. Bot scores and rate limiting depend on your Cloudflare plan.",
    },
    {
      q: "Which plan includes it?",
      a: `Cloudflare comes with the ${MODULE_PLAN} plan, together with Search Console.${ONLY_PLAN ? " No other plan includes it." : ""}`,
    },
    {
      q: "Will it change my Cloudflare settings on its own?",
      a: "No. Rules only go live after you preview and confirm them, and Click Guard findings are never published automatically. It doesn't change your security level, and it doesn't touch DNS or SSL settings.",
    },
    {
      q: "What happens if I disconnect?",
      a: "ConstructHUB deletes its copy of the data and, when it created the key, deletes that key in Cloudflare. Rules already applied stay in place, so undo them first or remove them in Cloudflare.",
    },
    {
      q: "Is the data live?",
      a: "No. Syncs run in the background and each one covers the last day. Some Cloudflare datasets are sampled, and data your Cloudflare plan doesn't provide shows as unavailable.",
    },
  ],
  related: ["searchConsole", "domains", "clickGuard"],
  app: { href: "/cloudflare", surface: "app" },
  headings: {
    cards: { title: "What You Can Do ", em: "From Here" },
  },
  seo: {
    title: "Cloudflare — Zones, Traffic and Firewall Rules | ConstructHUB",
    description:
      "Connect Cloudflare zones with a limited key, see traffic and firewall events, and apply previewed rule packs for ads pages, bad bots and flagged IPs, with undo.",
  },
  sources: [
    "client/src/pages/site-connections.tsx",
    "server/cloudflare/routes.ts",
    "server/cloudflare/service.ts",
    "server/cloudflare/client.ts",
    "server/cloudflare/common.ts",
    "server/cloudflare/hooks.ts",
    "server/cloudflare/worker.ts",
    "shared/plans.ts",
  ],
};

export default page;
