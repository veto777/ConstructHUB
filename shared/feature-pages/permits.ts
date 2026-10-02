import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";

/**
 * Permit Database Search (+ the Database Directory).
 *
 * Every claim below is backed by the code in `sources`:
 *   - search area (state → county/city, or every live-searchable portal), the six search types, the per-portal
 *     status while a search runs, status + date filters, View details, Property lookup: client/src/pages/search.tsx
 *   - which portals can be searched live (a verified/source-listed link AND an adapter): shared/government-links.ts
 *     canScrapeGovernmentPortal + governmentLinksAvailable; server/routes.ts POST /api/search; server/scraper.ts
 *     startLiveSearch (several portals at a time) and scrapePermitDetail (detail pages where the portal has them)
 *   - only a live portal search reserves the monthly quota; an area with nothing searchable answers
 *     noSearchablePortals and reserves nothing: server/routes.ts POST /api/search; server/growth-quotas.ts
 *   - the directory (state / county / type filters, checked links, "not auto-verified · Last checked",
 *     "Find permit portal" web search): client/src/pages/databases.tsx, shared/government-links.ts,
 *     scripts/verify-links.ts, scripts/build-permit-portals.ts; it is public: client/src/App.tsx PublicRouter
 *   - history (saved with results, delete one or all): client/src/pages/history.tsx, server/routes.ts /api/search-queries
 */

const SEARCHES: FeatureAllowance = { limit: "permitSearches", unit: "permit searches", period: "month" };

const page: FeaturePage = {
  key: "permits",
  slug: "permits",
  group: "win",
  status: "ready",
  title: "Permit Database Search",
  kicker: "Building permits",
  headline: { lead: "Search Building Permits From ", swipe: "One\u00a0Place" },
  lede:
    "Search the government permit portals we can query live by address, permit number, name, company or license, " +
    "and browse a directory of US county and city permit offices with checked links to their official portals.",
  hero: { mascot: "standing", bubble: "Let's see what's being permitted around you." },
  steps: [
    {
      title: "Pick your area",
      body: "Choose a state, then a county or city, or search every live-searchable portal at once.",
    },
    {
      title: "Search by what you know",
      body: "An address, keyword, name, company name, license number or permit number. Each portal accepts what its own system supports.",
    },
    {
      title: "Watch the portals answer",
      body: "Results arrive portal by portal, and each portal shows whether it was searched, skipped or could not be searched, so an empty list never hides a failed search.",
    },
    {
      title: "Filter and follow up",
      body: "Narrow by status and date, open a permit's details where the portal offers them, and jump to the county's property records.",
    },
  ],
  cards: [
    {
      icon: "search",
      title: "Live portal search",
      body: "It queries the supported government permit portals in your area for you, several at a time, instead of one website after another.",
    },
    {
      icon: "layers",
      title: "One results list",
      body: "Permit number, type, status, address, description, dates, applicant, contractor and parcel: whatever each portal publishes, in one list.",
    },
    {
      icon: "database",
      title: "Database Directory",
      body: "US counties and cities, filterable by state, county and type, with each jurisdiction's official permit portal where one is on record.",
    },
    {
      icon: "check",
      title: "Checked links, never guessed",
      body: "Portal links come from real sources and are checked. One we couldn't confirm shows its last check date; with no link on record you get a web search, not a made-up address.",
    },
    {
      icon: "building",
      title: "Straight to property records",
      body: "Each result has a Property lookup link to the county's assessor or appraiser office when one is on record.",
    },
    {
      icon: "history",
      title: "Search history",
      body: "Every search is saved with its results. Reopen a past search, or delete the ones you no longer need.",
    },
  ],
  spotlight: {
    kicker: "The Results",
    heading: { title: "What a Permit Result ", em: "Can\u00a0Show" },
    points: [
      "While a search runs, each portal shows its own status: searching, searched, skipped or not searched.",
      "Filter the results by permit status and by a date range.",
      "Where a portal offers a detail page, View details loads the full record.",
      "Only a live portal search uses your monthly allowance; an area with no searchable portal uses nothing.",
    ],
    panel: {
      label: "A permit result",
      title: "Fields a result can hold",
      items: [
        "Permit number", "Permit type", "Status", "Address", "Description", "Issued date",
        "Expiration or final date", "Applicant", "Contractor", "Parcel number", "Contacts", "Property lookup link",
      ],
      note: "Which fields appear depends on what each portal publishes.",
    },
  },
  audience: [
    {
      title: "Trades looking for work",
      body: "See what's being permitted in your service area, and which contractors are on the permits where the portal lists them.",
    },
    {
      title: "Contractors checking a job",
      body: "Look up a property's permits and its county records before you price the work.",
    },
    {
      title: "Companies moving into new areas",
      body: "Find the permit office and official portal for each county or city you're starting to work in.",
    },
  ],
  pricing: {
    kind: "plan",
    allowance: SEARCHES,
    note: "Only a live portal search counts. The Database Directory and your saved results never do.",
  },
  faqs: [
    {
      q: "Which permit portals can it search?",
      a: "Only portals we have a working search connection for and whose link is live or listed by a real source, so coverage varies by area. When no portal in your area can be searched live, the page says so, points you to the Database Directory, and nothing is counted.",
    },
    {
      q: "Which plans include it, and how many searches do I get?",
      a: `Every plan includes permit searches. ${allowanceLine(SEARCHES)}. Only a live portal search counts, and the count resets on the 1st of each month (UTC).`,
    },
    {
      q: "Do I need an account to use the directory?",
      a: "No. The Database Directory and Property Records are open to anyone. Running a live permit search needs an account on a plan.",
    },
    {
      q: "Does it have every permit in the country?",
      a: "No. It shows what each government portal publishes, and only for the portals it can search. It doesn't add permits from other sources, and it doesn't send you alerts about new permits.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"):
  // the live search: server/routes.ts POST /api/search (searchable = governmentLinksAvailable && canScrapeGovernmentPortal,
  // saved results in scope, quota only when something is searchable), server/scraper.ts startLiveSearch (MAX_CONCURRENT = 4,
  // the address-only portal answered from saved results, liveSearchOutcome 'Not searched'); the six search types:
  // client/src/pages/search.tsx; the directory checks: scripts/build-permit-portals.ts PERMIT_HINT,
  // server/government-url-check.ts classifyGovernmentPage, server/government-link-policy.ts classifySourceListedLink,
  // shared/government-links.ts governmentLinkNotice, client/src/pages/databases.tsx "Find permit portal".
  inDepth: {
    heading: { title: "How a Building Permit Search ", em: "Works" },
    paragraphs: [
      "Building permit records live on county and city websites, and every one has its own search screen. Permit " +
        "Database Search runs your search on those government permit portals for you. Pick a state and a county or city, " +
        "or search every portal it can reach, choose what you are searching by, and it queries up to four portals at a " +
        "time and puts what they return in one list. Permits already saved from earlier searches of the portals in your " +
        "area show straight away while the live search runs.",
      "A portal is searched live only when two things are true: its link comes from a real source and is still usable, " +
        "and there is a working search connection for the system that portal runs on. Many counties don't meet both yet, " +
        "so coverage varies by area. When nothing in your area can be searched, the page says so and nothing is counted " +
        "against your monthly allowance.",
      "Each portal accepts the searches its own system supports. Some portals only search by address; for those, a " +
        "search by name or company checks the permits already saved from that portal instead, and the portal's status " +
        "line says so. A portal that times out, changes its pages or puts a sign-in in the way shows as not searched, " +
        "with the reason, never as zero results.",
      "The Database Directory is the other half of a permit lookup. It lists US counties and cities with each " +
        "jurisdiction's official permit portal where one is on record. A portal link has to load and look like a permit " +
        "page, not a city's general homepage, before it is published. A dead link, a parked domain or a page-not-found is " +
        "dropped; a source-listed link that the check couldn't confirm stays visible with its last check date. Where no " +
        "portal is on record you get a web search for that county's permit office, never a guessed address.",
    ],
    bulletsIntro: "A permit search can look for:",
    bullets: [
      "A street address",
      "A keyword, such as a type of work",
      "An applicant's name or a company name",
      "A contractor license number",
      "A permit number",
    ],
  },
  related: ["property", "competitors", "crm"],
  app: { href: "/search", surface: "app" },
  tryIt: { label: "Browse the Database Directory", href: "/databases" },
  headings: {
    steps: { title: "From Address to Permit Record in ", em: "Four\u00a0Steps" },
    cards: { title: "What Permit Search ", em: "Gives You" },
    faq: { title: "Before You ", em: "Search" },
  },
  seo: {
    title: "Building Permit Search for Contractors | ConstructHUB",
    description:
      "Search building permits on supported county and city portals by address, permit number, name or license, and find official permit offices across the US.",
  },
  legacyPath: "/permits-landing",
  sources: [
    "client/src/pages/search.tsx",
    "client/src/pages/databases.tsx",
    "client/src/pages/history.tsx",
    "client/src/App.tsx",
    "server/routes.ts",
    "server/scraper.ts",
    "server/growth-quotas.ts",
    "shared/government-links.ts",
    "scripts/verify-links.ts",
    "scripts/build-permit-portals.ts",
    "server/data/permit-portals.json",
    "shared/plans.ts",
    "server/storage.ts",
    "server/government-url-check.ts",
    "server/government-link-policy.ts",
  ],
};

export default page;
