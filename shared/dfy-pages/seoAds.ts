import type { DfyPage } from "./types";

/**
 * SEO & Ad Campaigns — done-for-you (catalog id dfy_seo_ads).
 *
 * Every claim below is backed by the code in `sources`:
 *   - what the service covers (local SEO strategy and implementation, Google Ads campaign setup and
 *     optimization, Local Services Ads enrollment, schema markup + Search Console + Analytics setup):
 *     client/src/lib/pricing-display.ts DFY_SERVICES "seo-ads"; the landing card adds citation building
 *     ("Local SEO, Google Ads, LSA setup, citation building"): client/src/pages/landing.tsx
 *   - a 6-month agreement, signed before payment: server/routes.ts SEO_PACKAGES.dfy_seo_ads (termMonths 6) and
 *     server/catalog.ts SEO_CONTRACT_REQUIRED_IDS ("require a signed contract before payment"); the 6-month minimum,
 *     the early-termination penalty and "non-refundable once work has commenced": client/src/pages/terms-of-use.tsx
 *     section 6 (the penalty's size is left to the agreement and the Terms: see the report on the two wordings)
 *   - quoted by a sales rep, never a listed price or an online checkout: server/catalog.ts DFY_CATALOG + isSalesOnly
 *   - nobody can promise rankings; the service agreement spells out what we deliver: client/src/pages/pricing.tsx
 *   - the request form: client/src/components/talk-to-sales.tsx → POST /api/seo-inquiry in server/routes.ts
 *   - part of the Complete Business Build: shared/cart-bundles.ts DFY_BUNDLE_PARTS
 * The In Depth section:
 *   - LSA = Google's pay-per-lead ads with the Google verified badge; citation = a website listing your NAP:
 *     server/data/hub-knowledge.md glossary
 *   - LSA verification (billing, proof of insurance, background checks, Business Profile linking, budget, trade
 *     licenses) before the ads go live: client/src/pages/lsa-guide.tsx section "verification"
 *   - the tools a contractor runs afterwards: Click Guard (shared/feature-pages/clickGuard.ts), LSA Leads
 *     (shared/feature-pages/lsaLeads.ts)
 */
const page: DfyPage = {
  key: "seoAds",
  slug: "seo-ads-management",
  status: "ready",
  title: "SEO & Ad Campaigns",
  kicker: "Done-for-you marketing",
  headline: { lead: "Local SEO and Google Ads, ", swipe: "Handled for You" },
  lede:
    "Local SEO plus Google Ads and Local Services Ads set up for you, with schema markup, Search Console and " +
    "Analytics in place, on a 6-month agreement.",
  hero: { mascot: "standing", bubble: "You run the jobs. We'll run the campaigns." },
  catalogIds: ["dfy_seo_ads"],
  icon: "megaphone",
  blurb: "Local SEO, Google Ads and Local Services Ads",
  steps: [
    {
      title: "Tell us what you need",
      body: "Send the sales request with your name, email, your trades and the areas you serve. It's free and needs no account.",
    },
    {
      title: "Agree the scope and price",
      body: "A sales rep confirms the work and the price with you, on a 6-month agreement, before you commit or pay.",
    },
    {
      title: "We set it up",
      body: "Schema markup, Search Console and Analytics, your Google Ads campaigns and your Local Services Ads enrollment.",
    },
    {
      title: "We keep at it",
      body: "Local SEO work and campaign optimization carry on through the agreement.",
    },
  ],
  cards: [
    {
      icon: "map-pin",
      title: "Local SEO strategy",
      body: "A local SEO plan for your trades and service area, and the work to carry it out.",
    },
    {
      icon: "list",
      title: "Citation building",
      body: "Your business listed on directory sites with the same name, address and phone.",
    },
    {
      icon: "megaphone",
      title: "Google Ads campaigns",
      body: "Campaign setup, then ongoing optimization through the agreement.",
    },
    {
      icon: "shield-check",
      title: "Local Services Ads enrollment",
      body: "We take your business through enrollment in Google's Local Services Ads.",
    },
    {
      icon: "code",
      title: "Schema markup",
      body: "Structured data on your site that describes your business to search engines.",
    },
    {
      icon: "chart",
      title: "Search Console and Analytics",
      body: "Google Search Console and Analytics set up, so you can see the results.",
    },
  ],
  audience: [
    {
      title: "Contractors ready to advertise",
      body: "You want Google Ads and Local Services Ads running without learning every setting yourself.",
    },
    {
      title: "Owners with a site but no plan",
      body: "Your website is live, but nobody is working on its local SEO or tracking it in Search Console and Analytics.",
    },
  ],
  pricing: {
    kind: "sales",
    topic: "SEO and ad campaigns",
    note: "It runs on a 6-month agreement; a rep scopes it and quotes it before you commit.",
  },
  faqs: [
    {
      q: "What do I need to start?",
      a: "Just the sales request: your name and email, and if you like your phone, your company and what you need. You don't need a ConstructHUB account. A rep replies by email to scope the campaigns.",
    },
    {
      q: "How long is the commitment?",
      a: "It runs on a 6-month agreement that you sign before you pay. Ending it early carries an early termination penalty, set out in your agreement and our Terms of Use, so the rep goes through the scope with you first.",
    },
    {
      q: "Can you promise first-page rankings or a number of leads?",
      a: "No. Google decides search rankings and which ads show, so nobody can promise them. Your service agreement spells out exactly what we deliver.",
    },
    {
      q: "How much does it cost?",
      a: "It's quoted for your business by a sales rep rather than sold at a listed price. The rep confirms the scope and the price with you before you commit or pay.",
    },
    {
      q: "Is it part of a plan?",
      a: "No. It's work our team does, so no plan includes it. It's also part of the Complete Business Build.",
    },
  ],
  // WRITING-GUIDE.md → "The In Depth section". Sources: DFY_SERVICES "seo-ads" (pricing-display.ts), the landing
  // card (citation building), hub-knowledge.md glossary, lsa-guide.tsx "verification", terms-of-use.tsx section 6.
  inDepth: {
    heading: { title: "Local SEO and Google Ads for Contractors, ", em: "Explained" },
    paragraphs: [
      "There are two ways to show up when someone nearby searches for your trade: the free results, which local SEO " +
        "works on, and the paid spots, which Google Ads and Local Services Ads buy. SEO & Ad Campaigns is our team " +
        "setting up both and working on them for the length of a 6-month agreement.",
      "Local SEO starts with a plan for your trades and the areas you serve, and then the work to carry it out. Part of " +
        "that is citation building: getting your business listed on directory sites with the same name, address and " +
        "phone each time. Schema markup is structured data added to your site's code that tells search engines your " +
        "business name, location and services in a form they read directly.",
      "Google Ads campaigns are pay-per-click ads: you pay Google when someone clicks. We set the campaigns up and keep " +
        "optimizing them through the agreement. Local Services Ads are Google's pay-per-lead ads, the ones with the " +
        "Google verified badge. Before they go live, Google asks for billing details, proof of insurance, background " +
        "checks, a linked Business Profile and your trade licenses, and Google decides when you pass. We take your " +
        "business through that enrollment; the documents are yours to provide.",
      "Search Console and Analytics are Google's free reporting tools. Search Console shows how your site appears in " +
        "Google Search; Analytics shows the visits it gets. With both set up, you can see what the work is doing " +
        "instead of taking anyone's word for it. If you'd like to watch your ads yourself, ConstructHUB's Click Guard " +
        "flags suspicious ad clicks and LSA Leads lists your Local Services leads, as software you run.",
      "It is quoted by a sales rep, and the request is free and needs no account. The agreement runs for 6 months and " +
        "is signed before you pay; ending it early carries a penalty set out in the agreement and our Terms of Use. " +
        "Google decides rankings and which ads show, so nobody can promise first-page results or a number of leads.",
    ],
  },
  related: ["seoContracts", "clickGuard", "lsaLeads"],
  headings: {
    steps: { title: "From Request to Running Campaigns in ", em: "Four Steps" },
    cards: { title: "What We ", em: "Set Up and Run" },
    faq: { title: "Before You ", em: "Send a Request" },
  },
  seo: {
    title: "Local SEO & Google Ads for Contractors | ConstructHUB",
    description:
      "Local SEO, citation building, Google Ads and Local Services Ads set up and managed for contractors on a 6-month agreement. Quoted by a sales rep.",
  },
  sources: [
    "client/src/lib/pricing-display.ts",
    "client/src/pages/landing.tsx",
    "client/src/pages/pricing.tsx",
    "client/src/pages/terms-of-use.tsx",
    "client/src/pages/lsa-guide.tsx",
    "client/src/components/talk-to-sales.tsx",
    "server/catalog.ts",
    "server/routes.ts",
    "server/data/hub-knowledge.md",
    "shared/feature-pages/clickGuard.ts",
    "shared/feature-pages/lsaLeads.ts",
    "shared/cart-bundles.ts",
  ],
};

export default page;
