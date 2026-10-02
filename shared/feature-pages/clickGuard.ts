import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { ADDONS, PLANS } from "../plans";
import { joinNames, plansWhere } from "../plan-copy";

/**
 * Click Guard — the ad-click side of the protected-website trio (Click Guard,
 * IP Tracker, VPN Shield share one list of websites per plan).
 *
 * Every claim below is backed by the code in `sources`:
 *   - the tracking code (async script tag, canvas fingerprint, device/browser/OS, referrer, landing page):
 *     server/tracking-script.ts; the snippet and where to paste it: client/src/pages/google-ads.tsx
 *   - the flags (bot user agents, >5 visits/IP/hour, >15 visits/IP/24h, same fingerprint from other IPs
 *     within a day, missing user agent) and the automatic block (flagged + >10 visits in the hour):
 *     server/routes.ts POST /api/click-guard/track
 *   - manual blocks (IPv4/IPv6, CIDR, wildcard): server/routes.ts POST …/block + server/route-guards.ts normalizeBlockedIp
 *   - the exclusion list (manual excludes first, whitelist removed, length 50–500): server/click-guard-exclusions.ts
 *   - the private list key + the generated Google Ads script (enabled campaigns, 500 cap, only adds):
 *     server/routes.ts GET …/exclusion-list and …/google-ads-script
 *   - analytics for a date range: server/routes.ts GET …/analytics
 *   - adding a website is gated on protectedSites ≠ 0 and counted against it: server/routes.ts POST /api/click-guard/domains
 *   - the Agency Google Ads manager reads a mapped client's Click Guard list: server/ads/worker.ts
 * Prices and allowances come from the price book (allowanceLine, PLANS, ADDONS), never typed.
 */

const SITES: FeatureAllowance = { limit: "protectedSites", unit: "websites", period: "count" };
const FIRST_PLAN = PLANS[plansWhere((plan) => plan.limits.protectedSites !== 0)[0] ?? "agency"].name;
const EXTRA_SITE = ADDONS.protected_site;
const EXTRA_SITE_PLANS = joinNames(EXTRA_SITE.availableOn.map((key) => PLANS[key].name));

const page: FeaturePage = {
  key: "clickGuard",
  slug: "click-guard",
  group: "protect",
  status: "ready",
  title: "Click Guard",
  kicker: "Ad click protection",
  headline: { lead: "Flag Suspicious Ad Clicks and ", swipe: "Exclude the IPs" },
  lede:
    "Click Guard records the visits your tracking code sees, flags patterns like one IP visiting again and again or one " +
    "device behind several IPs, and keeps an IP exclusion list your Google Ads account pulls in with a script you schedule.",
  hero: { mascot: "standing", bubble: "Let's see who keeps clicking your ads." },
  steps: [
    {
      title: "Add your website",
      body: "Add the domain your Google Ads send people to. Each website counts toward your plan's protected websites.",
    },
    {
      title: "Paste the tracking code",
      body: "Put one short script tag in the header or footer of every page your ads point to. It loads asynchronously.",
    },
    {
      title: "Review flagged traffic",
      body: "Unusual visits are flagged with the reason. A flagged IP with more than 10 visits in an hour is blocked on its own, and you can block or unblock any IP yourself.",
    },
    {
      title: "Schedule the Google Ads script",
      body: "Paste the script Click Guard writes into Google Ads → Scripts and run it hourly. Each run adds newly listed IPs as exclusions on your enabled campaigns.",
    },
  ],
  cards: [
    {
      icon: "shield-alert",
      title: "Flags with a reason",
      body: "Bot and headless-browser user agents, more than 5 visits from one IP in an hour, heavy repeat visits over a day and a missing user agent are each flagged and labelled.",
    },
    {
      icon: "fingerprint",
      title: "One device, many IPs",
      body: "A browser fingerprint lets Click Guard notice the same device coming back from different IP addresses within a day.",
    },
    {
      icon: "shield",
      title: "Automatic and manual blocks",
      body: "Repeat offenders are blocked automatically. Add single IPv4 or IPv6 addresses, CIDR ranges or wildcards like 203.0.113.* yourself.",
    },
    {
      icon: "list",
      title: "Your exclusion rules",
      body: "List IPs you always want excluded, whitelist your office and crew, and set the list length from 50 up to Google's 500 per campaign.",
    },
    {
      icon: "code",
      title: "A script for your Ads account",
      body: "Click Guard writes a Google Ads script with a private link to your list. It runs inside your own Google Ads account, so there's no Google sign-in to share.",
    },
    {
      icon: "chart",
      title: "Traffic at a glance",
      body: "Visits, unique visitors, the share flagged, devices, browsers, countries and the sites that sent each visit, for the dates you pick.",
    },
  ],
  spotlight: {
    kicker: "The Exclusion List",
    heading: { title: "What Your Google Ads Script ", em: "Pulls In" },
    points: [
      "Your manual exclusions go first, then blocked IPs, newest first.",
      "Whitelisted IPs and ranges are taken out before the list is served.",
      "The list stops at the length you choose, up to Google's limit of 500 per campaign.",
      "The script only adds exclusions. It never removes ones already in Google Ads.",
      "The list link carries a private key, so only your script can read it.",
    ],
    panel: {
      label: "Click Guard settings",
      title: "What builds the list",
      items: [
        "Manually exclude IPs", "Blocked IPs (automatic)", "Blocked IPs (manual)", "Whitelist IPs",
        "Exclusion list length", "Exclusion list URL", "Google Ads script", "Manual copy of the list",
      ],
      note: "Schedule the script to run hourly and check its Logs tab in Google Ads to confirm each run.",
    },
  },
  audience: [
    {
      title: "Contractors paying for Google Ads",
      body: "You pay per click and want to see which visitors keep coming back from the same IP or device.",
    },
    {
      title: "Owners who run their own campaigns",
      body: "You can paste a script into Google Ads once and let it pick up new exclusions every hour.",
    },
    {
      title: "Agencies with client ad accounts",
      body: "Protect each client's website, and on the Agency plan the Google Ads manager can apply a client's list after a preview.",
    },
  ],
  pricing: {
    kind: "allowance",
    allowance: SITES,
    note: `One protected website covers Click Guard, IP Tracker and VPN Shield together. The ${EXTRA_SITE.name} add-on adds one more.`,
  },
  faqs: [
    {
      q: "What do I need to set it up?",
      a: "A website where you can add a script tag, and a Google Ads account where you can create scripts. Visits are only recorded when the tracking code runs in the visitor's browser, so pages without the code and browsers that block scripts aren't counted.",
    },
    {
      q: "Which plans include it?",
      a: `Click Guard is included from the ${FIRST_PLAN} plan. Protected ${allowanceLine(SITES)}. One website covers Click Guard, IP Tracker and VPN Shield, and the ${EXTRA_SITE.name} add-on adds one more on the ${EXTRA_SITE_PLANS} plans.`,
    },
    {
      q: "Does it stop click fraud or get my money back?",
      a: "No. Click Guard flags patterns and keeps an exclusion list. A flag doesn't prove who clicked and can catch a real customer, so review the list. It doesn't file refund claims, and an exclusion only applies to campaigns that support IP exclusions.",
    },
    {
      q: "What does it change in my Google Ads account?",
      a: "Only what the script you install does: it adds IP exclusions to your enabled campaigns, up to Google's 500 per campaign, and never removes any. Pause the script in Google Ads and nothing more changes.",
    },
    {
      q: "Will the tracking code slow my site down?",
      a: "It loads asynchronously, so your page doesn't wait for it, and it sends one small message per page view.",
    },
  ],
  related: ["ipTracker", "vpnShield", "masterClass"],
  app: { href: "/google-ads", surface: "app" },
  headings: {
    steps: { title: "From Website to Exclusion List in ", em: "Four Steps" },
    cards: { title: "What Click Guard ", em: "Does" },
    faq: { title: "Before You ", em: "Install It" },
  },
  seo: {
    title: "Click Guard — Ad Click Fraud Protection | ConstructHUB",
    description:
      "Flag repeat and automated visits from your Google Ads, block suspicious IPs and sync an IP exclusion list to your campaigns with a script you schedule.",
  },
  legacyPath: "/google-ads-landing",
  sources: [
    "client/src/pages/google-ads.tsx",
    "client/src/pages/google-ads-landing.tsx",
    "server/routes.ts",
    "server/tracking-script.ts",
    "server/click-guard-exclusions.ts",
    "server/route-guards.ts",
    "server/ads/worker.ts",
    "shared/plans.ts",
  ],
};

export default page;
