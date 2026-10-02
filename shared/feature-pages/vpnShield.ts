import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { ADDONS, PLANS } from "../plans";
import { plansWhere } from "../plan-copy";

/**
 * VPN Shield — the VPN/proxy check of the protected-website trio (Click Guard,
 * IP Tracker, VPN Shield share one list of websites per plan).
 *
 * Every claim below is backed by the code in `sources`:
 *   - its own script tag (separate from Click Guard's), skips known crawlers, WebRTC public-address check,
 *     VPN-extension markers, the "Access Restricted" overlay and the redirect: server/routes.ts
 *     GET /api/vpn-shield/script/:trackingId and GET …/domains/:id/script
 *   - detection (built-in VPN-provider prefixes, data center prefixes, WebRTC address ≠ request address,
 *     extension marker), crawler pass-through, whitelist, block/log/redirect: server/routes.ts POST /api/vpn-shield/track
 *   - settings (block | log | redirect, http(s) redirect link, whitelist up to 500 IPs): server/routes.ts POST …/settings
 *   - stats (total, today, unique IPs, top providers, top countries) and the flagged-visit log: server/routes.ts
 *     GET …/stats, …/blocked-visits; labels and caveats: client/src/pages/vpn-shield.tsx
 *   - the timezone signal the page still describes is ignored by the server, so it is not claimed here
 *   - adding a website is gated on protectedSites ≠ 0: server/routes.ts POST /api/click-guard/domains
 */

const SITES: FeatureAllowance = { limit: "protectedSites", unit: "websites", period: "count" };
const FIRST_PLAN = PLANS[plansWhere((plan) => plan.limits.protectedSites !== 0)[0] ?? "agency"].name;

const page: FeaturePage = {
  key: "vpnShield",
  slug: "vpn-shield",
  group: "protect",
  status: "ready",
  title: "VPN Shield",
  kicker: "VPN & proxy traffic",
  headline: { lead: "Choose What ", swipe: "VPN Visitors", tail: " See" },
  lede:
    "VPN Shield checks each visit for signs of a VPN or proxy, like a known VPN or data center address, and then " +
    "blocks, logs or redirects the visit, your choice.",
  hero: { mascot: "standing", bubble: "Let's see who's browsing behind a VPN." },
  steps: [
    {
      title: "Add your website",
      body: "It uses the same list of protected websites as Click Guard and IP Tracker.",
    },
    {
      title: "Install the VPN Shield script",
      body: "Paste its script tag in your site's head or before the closing body tag. It's separate from the Click Guard code.",
    },
    {
      title: "Choose the response",
      body: "Block shows flagged browsers an Access Restricted screen, Log only records them, and Redirect sends them to a page you choose.",
    },
    {
      title: "Review detections",
      body: "See today's and all-time detections, the top providers and countries, and every flagged visit with how it was detected.",
    },
  ],
  cards: [
    {
      icon: "globe",
      title: "Known VPN and data center ranges",
      body: "The visitor's IP is checked against a built-in list of VPN provider and data center address prefixes.",
    },
    {
      icon: "zap",
      title: "Browser signals",
      body: "A visit is flagged when the browser's public WebRTC address differs from the one it came from, or a VPN extension leaves a marker the script can see.",
    },
    {
      icon: "shield-off",
      title: "Block, log or redirect",
      body: "Show an Access Restricted screen, only record the visit, or send it to a full http or https link you set.",
    },
    {
      icon: "check",
      title: "Search engines pass",
      body: "Googlebot, Bingbot, AdsBot-Google and other known crawlers are never checked or blocked.",
    },
    {
      icon: "users",
      title: "Your whitelist",
      body: "Up to 500 IP addresses, like your office or crew, that are never flagged.",
    },
    {
      icon: "list",
      title: "Flagged visit log",
      body: "Each flagged visit with its IP, provider, detection method, landing page and the action taken.",
    },
  ],
  audience: [
    {
      title: "Contractors running ads",
      body: "Keep visits from data center and VPN addresses off your landing pages, or log them first to see how many there are.",
    },
    {
      title: "Owners who want a say over anonymous traffic",
      body: "Pick block, log only or redirect for each website, and whitelist the addresses you trust.",
    },
  ],
  pricing: {
    kind: "allowance",
    allowance: SITES,
    note: `One protected website covers VPN Shield, Click Guard and IP Tracker together. The ${ADDONS.protected_site.name} add-on adds one more.`,
  },
  faqs: [
    {
      q: "What do I need to use it?",
      a: "A website where you can add a script tag. VPN Shield runs in the visitor's browser, so it only acts on visitors whose browser runs the script.",
    },
    {
      q: "Which plans include it?",
      a: `VPN Shield is included from the ${FIRST_PLAN} plan. Protected ${allowanceLine(SITES)}. One website covers VPN Shield, Click Guard and IP Tracker.`,
    },
    {
      q: "Will it block real customers?",
      a: "It can. Plenty of people use a VPN for good reasons and every signal can misfire, so start with Log only, look at the flagged visits, and whitelist addresses you trust before you switch to Block.",
    },
    {
      q: "Does it catch every VPN?",
      a: "No. The provider and data center list is a limited built-in set that can be incomplete or out of date, and proxies that use home internet addresses won't match it.",
    },
    {
      q: "Is it a firewall?",
      a: "No. It acts in the browser after the page loads: someone who blocks scripts still sees your site, and requests to your server aren't stopped. On the Agency plan, the Cloudflare tool can block IP addresses you choose at the edge.",
    },
  ],
  related: ["clickGuard", "ipTracker", "cloudflare"],
  app: { href: "/vpn-shield", surface: "app" },
  headings: {
    cards: { title: "How VPN Shield ", em: "Checks a Visit" },
  },
  seo: {
    title: "VPN Shield — Block VPN and Proxy Visits | ConstructHUB",
    description:
      "Detect visits from VPNs, proxies and data center IP ranges on your website, then block, log or redirect them, with a whitelist and a log of every flagged visit.",
  },
  sources: [
    "client/src/pages/vpn-shield.tsx",
    "server/routes.ts",
    "server/route-guards.ts",
    "shared/plans.ts",
  ],
};

export default page;
