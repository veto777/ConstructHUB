import type { DfyPage } from "./types";

/**
 * GMB & Website Setup — done-for-you (catalog id dfy_gmb_website).
 *
 * Every claim below is backed by the code in `sources`:
 *   - what the service covers (Business Profile creation and verification, a contractor website's design and
 *     content, service pages per trade and location pages per service area, photo optimization and a GMB posting
 *     calendar): client/src/lib/pricing-display.ts DFY_SERVICES "website"; the landing card: client/src/pages/landing.tsx
 *   - quoted by a sales rep, never a listed price or an online checkout: server/catalog.ts DFY_CATALOG + isSalesOnly;
 *     scope and price confirmed before you commit or pay, fees non-refundable once work has commenced:
 *     client/src/pages/terms-of-use.tsx section 6
 *   - nobody can promise rankings; the service agreement spells out what we deliver: client/src/pages/pricing.tsx
 *   - the request form: client/src/components/talk-to-sales.tsx → POST /api/seo-inquiry in server/routes.ts
 *   - part of the Complete Business Build: shared/cart-bundles.ts DFY_BUNDLE_PARTS
 */
const page: DfyPage = {
  key: "gmbWebsite",
  slug: "gmb-website-setup",
  status: "ready",
  title: "GMB & Website Setup",
  kicker: "Done-for-you web presence",
  headline: { lead: "Your Google Profile and Website, ", swipe: "Built for You" },
  lede:
    "We create and verify your Google Business Profile and build a contractor website for your trades and service " +
    "area, with a page for each trade you offer and each area you serve.",
  hero: { mascot: "standing", bubble: "Let's get you found when people search for your trade." },
  catalogIds: ["dfy_gmb_website"],
  icon: "globe",
  blurb: "Your Business Profile and a contractor website",
  steps: [
    {
      title: "Tell us what you need",
      body: "Send the sales request with your name, email and your trades and service area. It's free and needs no account.",
    },
    {
      title: "Agree the scope and price",
      body: "A sales rep confirms the pages, the profile work and the price with you before you commit or pay.",
    },
    {
      title: "We build it",
      body: "We set up and verify your Business Profile and build the website: design, content, service pages and location pages.",
    },
    {
      title: "Photos and posting",
      body: "We optimize your photos and set up a posting calendar for your Business Profile.",
    },
  ],
  cards: [
    {
      icon: "map-pin",
      title: "Google Business Profile",
      body: "We create your Business Profile and take it through Google's verification.",
    },
    {
      icon: "globe",
      title: "A contractor website",
      body: "Design and content for a site built around your trades and your service area.",
    },
    {
      icon: "layers",
      title: "Service and location pages",
      body: "A page for each trade you offer and a page for each area you serve.",
    },
    {
      icon: "image",
      title: "Photo optimization",
      body: "Your job photos prepared for the profile and the website.",
    },
    {
      icon: "calendar",
      title: "A posting calendar",
      body: "A schedule of Google Business Profile posts, set up for you.",
    },
  ],
  audience: [
    {
      title: "New businesses with no web presence",
      body: "You're starting out and need a verified profile and a website before the first jobs come in.",
    },
    {
      title: "Contractors with an outdated site",
      body: "Your site doesn't list your trades or the areas you serve, and you want it rebuilt with a page for each.",
    },
  ],
  pricing: {
    kind: "sales",
    topic: "GMB and website setup",
    note: "Sending the request is free; a rep scopes the work and quotes it before you commit.",
  },
  faqs: [
    {
      q: "What do I need to start?",
      a: "Just the sales request: your name and email, and if you like your phone, your company and what you need. You don't need a ConstructHUB account. A rep replies by email to scope the profile and the website.",
    },
    {
      q: "How much does it cost?",
      a: "It's quoted for your business by a sales rep rather than sold at a listed price. The rep confirms the scope and the price with you before you commit or pay.",
    },
    {
      q: "Will my business rank at the top of Google?",
      a: "Nobody can promise that: Google decides search rankings. We build the profile and the site, and your service agreement spells out exactly what we deliver.",
    },
    {
      q: "Is it part of a plan?",
      a: "No. It's work our team does, so no plan includes it. Once it's built, the ConstructHUB tools for your Business Profile and website come with a plan. It's also part of the Complete Business Build.",
    },
  ],
  related: ["seoAds", "gbp", "siteScan"],
  headings: {
    steps: { title: "From Request to Live Profile in ", em: "Four Steps" },
    cards: { title: "What We ", em: "Build" },
  },
  seo: {
    title: "GMB & Website Setup for Contractors | ConstructHUB",
    description:
      "We create and verify your Google Business Profile and build your contractor website with service and location pages. Quoted by a sales rep for your business.",
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
