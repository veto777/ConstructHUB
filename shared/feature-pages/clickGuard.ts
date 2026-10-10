import type { FeatureAllowance, FeatureCompare, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { ADDONS, PLANS, planForModule } from "../plans";
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
const ADS_MANAGER_PLAN = PLANS[planForModule("adsManager")].name;

export const CLICK_GUARD_COMPARE: FeatureCompare = {
  // Prices read on 2026-10-10 from: clickcease.com/pricing, clickguard.com/pricing, fraudblocker.com/pricing
  // (~/codex-audits/a-la-carte-competitors.md → click_guard). Lunio is quote only.
  alacarte: ["click_guard"],
  checkedOn: "2026-10-10",
  competitors: [
    { name: "ClickCease", plan: "Starter", price: { kind: "monthly", cents: 9900 }, per: "1 site", note: "a lower intro price for the first three cycles", source: "https://www.clickcease.com/pricing" },
    { name: "ClickGUARD", plan: "Lite", price: { kind: "monthly", cents: 7400 }, per: "1 site", source: "https://www.clickguard.com/pricing" },
    { name: "Fraud Blocker", plan: "Standard", price: { kind: "monthly", cents: 7900 }, per: "1 site", source: "https://fraudblocker.com/pricing" },
    { name: "Lunio", price: { kind: "quote" } },
  ],
  onlyUs: [
    "A visitor-by-visitor IP log: who is online now, traffic sources, top pages and the last visits of any address.",
    "A per-site VPN policy — block, log or redirect — that never blocks search engines, with a whitelist for your office and crew.",
    "The exclusion script runs inside your own Google Ads account and only ever adds, up to Google's 500 per campaign.",
    "Manual blocks by single IP, CIDR range or wildcard.",
  ],
  theyNotUs: "Meta and Microsoft ads, filing refund claims with Google, and firewall-level blocking.",
  noContractorAlternative: true,
};

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
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): what the code reports is
  // server/tracking-script.ts (fp(), send()); the flags and the automatic block are server/routes.ts
  // POST /api/click-guard/track (BOT_PATTERNS, the hour/day counts, the fingerprint query); manual blocks and the
  // refused wide ranges are server/route-guards.ts normalizeBlockedIp; the list order, whitelist and 50–500 length
  // are server/click-guard-exclusions.ts buildExclusionList/exclusionListCap; the script (enabled campaigns, skips
  // existing, stops at 500, only adds) is server/routes.ts GET …/google-ads-script; the Agency preview is
  // server/ads/worker.ts (job.kind === "preview", input.kind === "ip").
  inDepth: {
    heading: { title: "Google Ads Click Fraud Protection, ", em: "Explained" },
    paragraphs: [
      "Click Guard is click fraud protection for contractors who pay for Google Ads. It starts with a short tracking " +
        "code on the pages your ads point to. Each time one of those pages loads, the code reports the visit: the IP " +
        "address it came from, the device type, browser, operating system, screen size, language and time zone, the " +
        "page landed on and the site that sent the visitor. It also takes a browser fingerprint, a short code made from " +
        "how that browser draws a small test image, so the same device can be recognized when it comes back from a " +
        "different IP address.",
      "Every visit is checked as it arrives. It is flagged when the user agent (the name a browser sends with each " +
        "request) belongs to a bot, a crawler, a headless browser or a scripting tool, or is missing; when one IP " +
        "makes more than 5 visits in an hour or more than 15 in a day; or when the same fingerprint was seen from " +
        "another IP within the day. Each flag keeps its reason. A flagged IP that passes 10 visits in an hour is " +
        "added to your blocked list automatically. The rest is your call: block a single IPv4 or IPv6 address, a CIDR " +
        "range (a block of neighbouring addresses) or a wildcard like 203.0.113.*, and unblock any of them. Very wide " +
        "ranges are refused.",
      "Google Ads lets each campaign exclude up to 500 IP addresses. Click Guard turns your blocked list into that IP " +
        "exclusion list: your manual exclusions first, then blocked IPs from newest to oldest, with your whitelisted " +
        "office and crew addresses taken out, cut off at the length you set between 50 and 500. It then writes a " +
        "Google Ads script for you to paste into your account and schedule hourly. On each run the script fetches the " +
        "list through a private link, skips addresses a campaign already excludes and adds the rest to every enabled " +
        "campaign until that campaign is full. It runs inside your own Google Ads account, so there is no Google " +
        "sign-in to share, and it only adds exclusions. It never removes one.",
      "A flag is a pattern, not proof. Several real customers behind one office or phone network can share an IP and " +
        "trip the visit limits, so check the blocked list and whitelist the addresses you trust. Click Guard only " +
        "sees visits where the tracking code runs, it doesn't file refund claims with Google, and an exclusion only " +
        `applies to campaigns that accept IP exclusions. On the ${ADS_MANAGER_PLAN} plan, the Google Ads manager can ` +
        "preview a mapped client's Click Guard list as exclusions in that client's ad account before applying it.",
    ],
  },
  compare: CLICK_GUARD_COMPARE,
  related: ["ipTracker", "vpnShield", "masterClass"],
  app: { href: "/google-ads", surface: "app" },
  headings: {
    steps: { title: "From Website to Exclusion List in ", em: "Four Steps" },
    cards: { title: "What Click Guard ", em: "Does" },
    faq: { title: "Before You ", em: "Install It" },
  },
  seo: {
    title: "Click Fraud Protection for Google Ads | ConstructHUB",
    description:
      "Flag bot, repeat and same-device clicks on your Google Ads, block suspicious IPs and sync an IP exclusion list to your campaigns with a script.",
  },
  legacyPath: "/google-ads-landing",
  sources: [
    "client/src/pages/google-ads.tsx",
    "server/routes.ts",
    "server/tracking-script.ts",
    "server/click-guard-exclusions.ts",
    "server/route-guards.ts",
    "server/ads/worker.ts",
    "shared/plans.ts",
  ],
};

export default page;
