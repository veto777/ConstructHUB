import type { DfyPage } from "./types";

/**
 * Monthly SEO packages — the SEO contracts (catalog ids dfy_seo_first_page, dfy_seo_growth, dfy_seo_domination).
 *
 * Every claim below is backed by the code in `sources`:
 *   - what every package includes (a dedicated SEO strategist, a technical SEO audit and fixes, keyword
 *     research + content + backlink building, monthly ranking reports) and "ongoing SEO for the keywords and
 *     service areas you choose, on a 6-month minimum": client/src/lib/pricing-display.ts DFY_SERVICES "seo-packages"
 *   - packages differ by how many keywords they target (the catalog names), all 6-month terms:
 *     server/catalog.ts DFY_CATALOG, server/routes.ts SEO_PACKAGES (termMonths 6), SEO_CONTRACT_REQUIRED_IDS
 *   - quoted by a sales rep, never a listed price or an online checkout or contract: server/catalog.ts isSalesOnly,
 *     server/routes.ts /api/contracts/create (sendTalkToSales for every package at or above the threshold)
 *   - the 6-month minimum, the early-termination penalty (half of the remaining contract value):
 *     client/src/pages/terms-of-use.tsx section 6
 *   - nobody can promise rankings; the service agreement spells out what we deliver: client/src/pages/pricing.tsx
 *   - the request form: client/src/components/talk-to-sales.tsx → POST /api/seo-inquiry in server/routes.ts
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
      body: "Packages are scoped by how many keywords you target. The rep confirms the scope and the price, on a 6-month minimum.",
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
      title: "Content and backlinks",
      body: "Content for your site and backlink building, every month.",
    },
    {
      icon: "chart",
      title: "Monthly ranking reports",
      body: "A ranking report every month for the keywords in your package.",
    },
  ],
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
    topic: "Monthly SEO packages",
    note: "Every package runs for a 6-month minimum; a rep scopes it and quotes it before you commit.",
  },
  faqs: [
    {
      q: "How are the packages different?",
      a: "They're scoped by how many keywords you target. A sales rep matches the package to the services and areas you choose and quotes it for your business.",
    },
    {
      q: "How long is the commitment?",
      a: "Every SEO package has a 6-month minimum. Ending an SEO contract early carries an early termination penalty of half the remaining contract value, as our Terms of Use say, so the rep goes through the scope with you first.",
    },
    {
      q: "Can you promise first-page rankings?",
      a: "No. Google decides search rankings, so nobody can promise them. You get a monthly ranking report, and your service agreement spells out exactly what we deliver.",
    },
    {
      q: "What do I need to start?",
      a: "Just the sales request: your name and email, and if you like your phone, your company and the keywords you have in mind. You don't need a ConstructHUB account. A rep replies by email.",
    },
  ],
  related: ["seoAds", "rankingGrid", "siteScan"],
  headings: {
    steps: { title: "How a Package ", em: "Runs" },
    cards: { title: "What Every Package ", em: "Includes" },
  },
  seo: {
    title: "Monthly SEO Packages for Contractors | ConstructHUB",
    description:
      "Ongoing SEO for contractors on a 6-month minimum: a dedicated strategist, a technical audit and fixes, keyword research, content, backlinks and monthly ranking reports.",
  },
  sources: [
    "client/src/lib/pricing-display.ts",
    "client/src/pages/pricing.tsx",
    "client/src/pages/terms-of-use.tsx",
    "client/src/components/talk-to-sales.tsx",
    "server/catalog.ts",
    "server/routes.ts",
  ],
};

export default page;
