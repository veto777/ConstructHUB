import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { ADDONS, PLANS } from "../plans";
import { plansWhere } from "../plan-copy";

/**
 * IP Tracker — the visitor log of the protected-website trio (Click Guard, IP
 * Tracker, VPN Shield share one list of websites per plan).
 *
 * Every claim below is backed by the code in `sources`:
 *   - same tracking code as Click Guard (one install covers both): client/src/pages/ip-tracker.tsx (snippet),
 *     server/tracking-script.ts (what the browser reports)
 *   - tabs Dashboard / Visitor List / Traffic Sources / Pages / Geo / Platforms, the stat cards (Online Now =
 *     last 20 minutes, Today, Yesterday, Last 7 Days, This Month), the 14-day chart, search by IP, site switcher,
 *     remove-site deletes visits and blocked IPs: client/src/pages/ip-tracker.tsx
 *   - visitor grouping by IP, visitor detail (system specs, geo, up to 50 recent visits with referrer and landing
 *     page, suspicion reasons), pages, geo, platforms, online: server/routes.ts GET /api/click-guard/domains/:id/…
 *   - each list loads the latest 1,000 visits: server/storage.ts getClickVisits (limit 1000) + VISIT_ROW_CAP
 *   - country/city from Cloudflare headers when present: server/route-guards.ts edgeGeo
 *   - adding a website is gated on protectedSites ≠ 0: server/routes.ts POST /api/click-guard/domains
 */

const SITES: FeatureAllowance = { limit: "protectedSites", unit: "websites", period: "count" };
const FIRST_PLAN = PLANS[plansWhere((plan) => plan.limits.protectedSites !== 0)[0] ?? "agency"].name;

const page: FeaturePage = {
  key: "ipTracker",
  slug: "ip-tracker",
  group: "protect",
  status: "ready",
  title: "IP Tracker",
  kicker: "Website visitors",
  headline: { lead: "See Who Visits Your Website, ", swipe: "Visit by Visit" },
  lede:
    "IP Tracker lists every visit your tracking code records: the IP address, device, browser, the page they landed on " +
    "and the site that sent them, with country and city where available.",
  hero: { mascot: "standing", bubble: "Who's been looking at your site today?" },
  steps: [
    {
      title: "Add your website",
      body: "Add the domain in IP Tracker. It shares your list of protected websites with Click Guard and VPN Shield.",
    },
    {
      title: "Paste the tracking code",
      body: "One script tag in your site's head or just before the closing body tag. It's the same code Click Guard uses, so one install covers both.",
    },
    {
      title: "Watch visits arrive",
      body: "Visits show up as the code runs: who is on the site now, today, this week and this month.",
    },
    {
      title: "Open any visitor",
      body: "See an IP's device, browser, screen, language and time zone, and its recent visits with where each one came from.",
    },
  ],
  cards: [
    {
      icon: "users",
      title: "Visitor list",
      body: "Every IP with its visit count, first and last visit, device and location. Search by IP address.",
    },
    {
      icon: "chart",
      title: "Online now and daily visits",
      body: "Who is on the site now (the last 20 minutes), today, yesterday, the last 7 days and this month, plus a 14-day chart.",
    },
    {
      icon: "link",
      title: "Traffic sources",
      body: "The websites that sent your visitors, by referring domain, with page loads and unique visitors for each.",
    },
    {
      icon: "file",
      title: "Top pages",
      body: "Hits and unique visitors for every landing page the code recorded.",
    },
    {
      icon: "map-pin",
      title: "Countries and cities",
      body: "Where visits came from, when a location is available. Visits without one show as Unknown.",
    },
    {
      icon: "layers",
      title: "Platforms",
      body: "Browsers, operating systems, device types and screen resolutions across your visitors.",
    },
  ],
  spotlight: {
    kicker: "Visitor Detail",
    heading: { title: "Everything One IP ", em: "Has Done on Your Site" },
    points: [
      "Visits are grouped by IP address, with a computer ID from the browser fingerprint.",
      "Recent activity lists up to 50 visits, each with its referrer and landing page.",
      "A suspicious visitor carries the reasons Click Guard recorded.",
      "Remove a site and its recorded visits and blocked IPs are deleted with it.",
    ],
    panel: {
      label: "Visitor detail",
      title: "What each visitor shows",
      items: [
        "IP address", "Computer ID", "Total visits", "First visit", "Last visit", "Browser", "Operating system",
        "Device", "Screen resolution", "Language", "Time zone", "Country and city", "Recent activity",
      ],
      note: "Fields the browser doesn't report stay empty; nothing is filled in.",
    },
  },
  audience: [
    {
      title: "Contractors curious about their traffic",
      body: "See whether visits come from search, ads or other sites, and which pages people land on.",
    },
    {
      title: "Owners running ads",
      body: "Check repeat visitors and devices right next to Click Guard's flags.",
    },
    {
      title: "Companies with several websites",
      body: "Switch between your sites from one screen; each one counts toward your protected websites.",
    },
  ],
  pricing: {
    kind: "allowance",
    allowance: SITES,
    note: `One protected website covers IP Tracker, Click Guard and VPN Shield together. The ${ADDONS.protected_site.name} add-on adds one more.`,
  },
  faqs: [
    {
      q: "What do I need to use it?",
      a: "A website where you can add a script tag. IP Tracker only sees visits where the code runs in the visitor's browser, so pages without the code and browsers that block scripts aren't recorded.",
    },
    {
      q: "Which plans include it?",
      a: `IP Tracker is included from the ${FIRST_PLAN} plan. Protected ${allowanceLine(SITES)}. One website covers IP Tracker, Click Guard and VPN Shield.`,
    },
    {
      q: "Can it tell me who a visitor is?",
      a: "No. It shows an IP address, a device fingerprint and what the browser reports. It doesn't give you names, companies or contact details, and it doesn't identify a person.",
    },
    {
      q: "How much history can I see?",
      a: "Each view loads the most recent 1,000 visits for its period. When a site has more, the counts are marked with a + because they are a lower bound.",
    },
    {
      q: "Where does the location come from?",
      a: "Country and city come from Cloudflare on visits recorded since that was added. Older visits, and visits it couldn't place, show Unknown.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): the shared code and what it reports are
  // server/tracking-script.ts send(); the IP is server/route-guards.ts visitorIp and country/city edgeGeo (Cloudflare
  // headers, never guessed); visitor grouping, "online" = 20 minutes, the 50-visit detail and suspicion reasons are
  // server/routes.ts GET …/visitors and …/visitors/:visitorIp; referrer domains and "NO REFERRER DATA" are
  // GET …/analytics; pages, geo and platforms are GET …/pages, …/geo, …/platforms; the 1,000-visit window is
  // server/storage.ts getClickVisits + client/src/pages/ip-tracker.tsx VISIT_ROW_CAP; removal is the ip-tracker.tsx dialog.
  inDepth: {
    heading: { title: "Website Visitor Tracking by IP, ", em: "Explained" },
    paragraphs: [
      "IP Tracker is website visitor tracking for contractors who want to see their traffic one visit at a time, not " +
        "only as a monthly total. It uses the same tracking code as Click Guard, so one script tag on your site feeds " +
        "both. Each time a page with the code loads, the visitor's browser reports its device type, browser, operating " +
        "system, screen size, language and time zone, the address of the page and the site that sent them. The IP " +
        "address comes from the connection itself. Country and city come from Cloudflare's network when it supplies " +
        "them, and a visit it can't place shows as Unknown rather than a guess.",
      "Visits are grouped by IP address. The visitor list shows each IP with its visit count, first and last visit, " +
        "latest device and location, and marks anyone seen in the last 20 minutes as online. Open an IP and you get " +
        "its system details, a computer ID made from the browser fingerprint, and up to 50 recent visits with the " +
        "referrer and landing page of each. When Click Guard flagged that IP, its reasons are listed there too, so the " +
        "two tools tell one story about the same visitor.",
      "The other tabs answer the everyday questions about a contractor website. Traffic Sources groups visits by the " +
        "website that sent them (the referrer), shown by domain name; visits that arrive without one, such as a typed " +
        "address or a bookmark, are grouped as No referrer data. Pages lists hits and unique visitors for each landing " +
        "page. Geo counts visits by country and city. Platforms breaks down browsers, operating systems, device types " +
        "and screen resolutions. The dashboard adds counts for today, yesterday, the last 7 days and this month, and a " +
        "14-day chart.",
      "What it can't do matters as much. An IP address is not a person: an office, a household or a phone network can " +
        "share one, and IP Tracker doesn't give you names, companies or contact details. Visits only count where the " +
        "code runs, so pages without it and browsers that block scripts are missing. Each view loads the most recent " +
        "1,000 visits for its period; when a site has more, the counts carry a + because they are a lower bound. " +
        "Removing a site stops tracking it and deletes its recorded visits and blocked IPs.",
    ],
  },
  related: ["clickGuard", "vpnShield", "siteScan"],
  app: { href: "/ip-tracker", surface: "app" },
  headings: {
    cards: { title: "What You See in ", em: "IP Tracker" },
  },
  seo: {
    title: "Website Visitor Tracking by IP Address | ConstructHUB",
    description:
      "See every visit to your contractor website by IP address: device, browser, landing page, referrer and location, who is online now and daily counts.",
  },
  sources: [
    "client/src/pages/ip-tracker.tsx",
    "server/tracking-script.ts",
    "server/routes.ts",
    "server/storage.ts",
    "server/route-guards.ts",
    "shared/plans.ts",
  ],
};

export default page;
