import type { DfyPage } from "./types";

/**
 * SEO & Ad Campaigns — done-for-you (catalog id dfy_seo_ads).
 *
 * Every claim below is backed by the code in `sources`:
 *   - what the service covers (local SEO strategy and implementation, Google Ads campaign setup and
 *     optimization, Local Services Ads enrollment, schema markup + Search Console + Analytics setup):
 *     client/src/lib/pricing-display.ts DFY_SERVICES "seo-ads"; the landing card: client/src/pages/landing.tsx
 *   - a 6-month agreement: server/routes.ts SEO_PACKAGES.dfy_seo_ads (termMonths 6) and server/catalog.ts
 *     SEO_CONTRACT_REQUIRED_IDS; the 6-month minimum and the early-termination penalty (half of the remaining
 *     contract value) and "non-refundable once work has commenced": client/src/pages/terms-of-use.tsx section 6
 *   - quoted by a sales rep, never a listed price or an online checkout: server/catalog.ts DFY_CATALOG + isSalesOnly
 *   - nobody can promise rankings; the service agreement spells out what we deliver: client/src/pages/pricing.tsx
 *   - the request form: client/src/components/talk-to-sales.tsx → POST /api/seo-inquiry in server/routes.ts
 *   - part of the Complete Business Build: shared/cart-bundles.ts DFY_BUNDLE_PARTS
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
      icon: "megaphone",
      title: "Google Ads campaigns",
      body: "Campaign setup and ongoing optimization.",
    },
    {
      icon: "shield-check",
      title: "Local Services Ads enrollment",
      body: "We take your business through enrollment in Google's Local Services Ads.",
    },
    {
      icon: "code",
      title: "Schema, Search Console and Analytics",
      body: "Schema markup on your site, and Google Search Console and Analytics set up.",
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
      a: "It runs on a 6-month agreement. Ending an SEO contract early carries an early termination penalty of half the remaining contract value, as our Terms of Use say, so the rep goes through the scope with you first.",
    },
    {
      q: "Can you promise first-page rankings or a number of leads?",
      a: "No. Google decides search rankings, so nobody can promise them. Your service agreement spells out exactly what we deliver.",
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
  related: ["seoContracts", "adsManager", "clickGuard"],
  headings: {
    steps: { title: "From Request to Running Campaigns in ", em: "Four Steps" },
    cards: { title: "What We ", em: "Set Up and Run" },
  },
  seo: {
    title: "SEO & Google Ads Management for Contractors | ConstructHUB",
    description:
      "Local SEO, Google Ads and Local Services Ads set up and managed for your contracting business on a 6-month agreement. Quoted by a sales rep.",
  },
  sources: [
    "client/src/lib/pricing-display.ts",
    "client/src/pages/landing.tsx",
    "client/src/pages/pricing.tsx",
    "client/src/pages/terms-of-use.tsx",
    "client/src/components/talk-to-sales.tsx",
    "server/catalog.ts",
    "server/routes.ts",
    "shared/cart-bundles.ts",
  ],
};

export default page;
