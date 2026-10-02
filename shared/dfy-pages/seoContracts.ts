import type { DfyPage } from "./types";

/**
 * Monthly SEO packages — the SEO contracts (catalog ids dfy_seo_first_page, dfy_seo_growth, dfy_seo_domination).
 *
 * Every claim below is backed by the code in `sources`:
 *   - what every package includes (a dedicated SEO strategist, a technical SEO audit and fixes, keyword
 *     research + content + backlink building, monthly ranking reports) and "ongoing SEO for the keywords and
 *     service areas you choose, on a 6-month minimum": client/src/lib/pricing-display.ts DFY_SERVICES "seo-packages"
 *   - three packages covering one to five keywords (the catalog names: 1-2, 1-2 and 3-5), all 6-month terms:
 *     server/catalog.ts DFY_CATALOG, server/routes.ts SEO_PACKAGES (termMonths 6), SEO_CONTRACT_REQUIRED_IDS
 *     ("require a signed contract before payment")
 *   - quoted by a sales rep, never a listed price or an online checkout or contract: server/catalog.ts isSalesOnly,
 *     server/routes.ts /api/contracts/create (sendTalkToSales for every package at or above the threshold)
 *   - the 6-month minimum, the early-termination penalty and the month-to-month renewal after it: the standard
 *     agreement (contract-sign.tsx sections 3 and 6). The penalty points to that agreement only: its size there and in
 *     terms-of-use.tsx section 6 differ, which is an owner/legal decision (see the report)
 *   - nobody can promise rankings; the service agreement spells out what we deliver: client/src/pages/pricing.tsx
 *   - the request form: client/src/components/talk-to-sales.tsx → POST /api/seo-inquiry in server/routes.ts
 * The spotlight and In Depth section read the standard SEO agreement, client/src/pages/contract-sign.tsx:
 *   - section 2 scope (audit + technical analysis, on-page: meta tags, headers, content structure, internal linking;
 *     off-page: backlinks, citation building, directory submissions; keyword research, mapping and rank tracking;
 *     monthly reporting; content strategy; Business Profile optimization where applicable; competitor analysis)
 *   - section 5 (no promise of rankings, traffic or conversions), section 10 (client gives access to the website admin,
 *     hosting and analytics, and reviews content within five business days), section 11 (content made for you is
 *     yours once that month is paid)
 *   - citation = a website listing your NAP: server/data/hub-knowledge.md glossary
 * The package names are deliberately not repeated here: they describe ranking targets, and the page promises no ranking.
 */
const page: DfyPage = {
  key: "seoContracts",
  slug: "seo-contracts",
  status: "ready",
  title: "Monthly SEO packages",
  ctaTitle: "Monthly SEO",
  kicker: "Ongoing SEO",
  headline: { lead: "Ongoing SEO for the Keywords ", swipe: "You Choose" },
  lede:
    "A dedicated SEO strategist works on the keywords and service areas you choose: a technical audit and fixes, " +
    "keyword research, content, backlinks and a ranking report every month, on a 6-month minimum agreement.",
  hero: { mascot: "standing", bubble: "Pick the searches you want to be found for." },
  catalogIds: ["dfy_seo_first_page", "dfy_seo_growth", "dfy_seo_domination"],
  icon: "trending-up",
  blurb: "Ongoing SEO for the keywords you choose",
  steps: [
    {
      title: "Pick your keywords",
      body: "Tell a sales rep the services and the areas you want to be found for. The request is free and needs no account.",
    },
    {
      title: "Agree the package",
      body: "There are three packages, covering one to five keywords. The rep confirms the scope and the price, on a 6-month minimum.",
    },
    {
      title: "Audit and fixes",
      body: "Your strategist starts with a technical SEO audit of your site and the fixes it calls for.",
    },
    {
      title: "Monthly work and reports",
      body: "Keyword research, content and backlink building each month, with a monthly ranking report.",
    },
  ],
  cards: [
    {
      icon: "users",
      title: "A dedicated SEO strategist",
      body: "One strategist who works on your keywords and service areas.",
    },
    {
      icon: "wrench",
      title: "Technical audit and fixes",
      body: "A technical SEO audit of your site, and the fixes it turns up.",
    },
    {
      icon: "search",
      title: "Keyword research",
      body: "Research into the searches for your trades in the areas you serve.",
    },
    {
      icon: "file",
      title: "Content",
      body: "Content for your site, planned around the keywords in your package.",
    },
    {
      icon: "link",
      title: "Backlink building",
      body: "Links to your site from other websites, built every month.",
    },
    {
      icon: "chart",
      title: "Monthly ranking reports",
      body: "A ranking report every month for the keywords in your package.",
    },
  ],
  spotlight: {
    kicker: "The Agreement",
    heading: { title: "What the SEO Agreement ", em: "Puts in Writing" },
    points: [
      "Every package runs on a signed agreement with a 6-month minimum term.",
      "After the 6 months it renews month to month unless either side gives 30 days' written notice.",
      "The agreement lists the work in plain terms, and states that no ranking, traffic level or conversion rate is promised.",
      "Content written for your site becomes yours once the month it was made in is paid.",
      "You give your strategist access to your website, hosting and analytics, and review content within five business days.",
    ],
    panel: {
      label: "The agreement",
      title: "The scope of services",
      items: [
        "Website audit", "Technical SEO analysis", "On-page optimization", "Backlinks", "Citation building",
        "Directory submissions", "Keyword research and mapping", "Rank tracking", "Monthly reports",
        "Content strategy", "Business Profile optimization", "Competitor analysis",
      ],
      note: "Business Profile optimization applies where you have a profile. Your rep goes through the agreement with you before you sign.",
    },
  },
  audience: [
    {
      title: "Contractors who want steady SEO work",
      body: "You'd rather have a strategist working on your search presence every month than do it between jobs.",
    },
    {
      title: "Businesses serving several areas",
      body: "You want the specific services and service areas you choose worked on, not a one-size plan.",
    },
  ],
  pricing: {
    kind: "sales",
    topic: "Each monthly SEO package",
    note: "Every package runs for a 6-month minimum; a rep scopes it and quotes it before you commit.",
  },
  faqs: [
    {
      q: "How are the packages different?",
      a: "There are three packages, covering one to five keywords. A sales rep matches one to the services and areas you choose and quotes it for your business.",
    },
    {
      q: "How long is the commitment?",
      a: "Every SEO package has a 6-month minimum, on an agreement you sign before you pay. Ending an SEO contract early carries an early termination penalty, set out in the agreement you sign before paying, so the rep goes through the scope with you first.",
    },
    {
      q: "Can you promise first-page rankings?",
      a: "No. Google decides search rankings, so nobody can promise them, and the agreement says so. You get a monthly ranking report, and your service agreement spells out exactly what we deliver.",
    },
    {
      q: "What do I need to start?",
      a: "Just the sales request: your name and email, and if you like your phone, your company and the keywords you have in mind. You don't need a ConstructHUB account. A rep replies by email. Once you sign, your strategist needs access to your website, hosting and analytics.",
    },
  ],
  // WRITING-GUIDE.md → "The In Depth section". Sources: DFY_SERVICES "seo-packages" (pricing-display.ts), the standard
  // agreement's sections 2, 5, 10 and 11 (contract-sign.tsx), terms-of-use.tsx section 6, the hub-knowledge.md glossary.
  inDepth: {
    heading: { title: "SEO Services for Contractors, ", em: "Month by Month" },
    paragraphs: [
      "SEO, search engine optimization, is the work that helps your website show up in Google's regular results when " +
        "someone searches for a service in your area. It isn't a one-time job: search results move, competitors change " +
        "their sites, and pages need upkeep. A monthly SEO package puts a dedicated strategist on it for the keywords and " +
        "service areas you choose, on a 6-month minimum agreement.",
      "The first piece of work is a technical SEO audit of your site and the fixes it calls for. Technical SEO is " +
        "whether search engines can reach, read and understand your pages. On-page optimization follows: the page titles " +
        "and meta descriptions people see in search results, the headings, how each page's content is structured, and " +
        "the internal links between your own pages.",
      "Keyword research finds the searches people make for your trades where you work, and keyword mapping gives each " +
        "search the page that should answer it. Off-page work happens on other sites: backlinks (links from other " +
        "websites to yours), citation building (directory listings with your name, address and phone) and directory " +
        "submissions. Content strategy decides what to write next, and rank tracking follows where your keywords stand.",
      "Every month you get a ranking report for the keywords in your package. There are three packages, covering one " +
        "to five keywords, and a sales rep matches one to the services and areas you choose and quotes it. The agreement " +
        "is signed before you pay; ending it before the 6 months are up carries an early termination penalty, set out " +
        "in the agreement you sign. After the 6 months it renews month to month unless either side gives 30 days' " +
        "written notice.",
      "Google decides rankings, so no package promises a position, traffic or conversions, and the agreement says " +
        "so in writing. If you want to see the picture yourself between reports, ConstructHUB's Site Scan audits your " +
        "site and the GMB Ranking Grid shows where you appear in Google Maps for a keyword, as software in a plan.",
    ],
  },
  related: ["seoAds", "rankingGrid", "siteScan"],
  headings: {
    steps: { title: "How a Package ", em: "Runs" },
    cards: { title: "What Every Package ", em: "Includes" },
    faq: { title: "Before You ", em: "Sign Up" },
  },
  seo: {
    title: "Monthly SEO Services for Contractors | ConstructHUB",
    description:
      "SEO services for contractors on a 6-month minimum: a dedicated strategist, technical fixes, keyword research, content, backlinks and ranking reports.",
  },
  sources: [
    "client/src/lib/pricing-display.ts",
    "client/src/pages/pricing.tsx",
    "client/src/pages/terms-of-use.tsx",
    "client/src/pages/contract-sign.tsx",
    "client/src/components/talk-to-sales.tsx",
    "server/catalog.ts",
    "server/routes.ts",
    "server/data/hub-knowledge.md",
    "shared/feature-pages/siteScan.ts",
    "shared/feature-pages/rankingGrid.ts",
  ],
};

export default page;
