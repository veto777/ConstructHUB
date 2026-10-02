import type { DfyPage } from "./types";

/**
 * GMB & Website Setup — done-for-you (catalog id dfy_gmb_website).
 *
 * Every claim below is backed by the code in `sources`:
 *   - what the service covers (Business Profile creation and verification, a contractor website's design and
 *     content, service pages per trade and location pages per service area, photo optimization and a GMB posting
 *     calendar): client/src/lib/pricing-display.ts DFY_SERVICES "website"; the landing card ("Full Google Business
 *     Profile, professional website, content"): client/src/pages/landing.tsx
 *   - quoted by a sales rep, never a listed price or an online checkout: server/catalog.ts DFY_CATALOG + isSalesOnly;
 *     scope and price confirmed before you commit or pay, fees non-refundable once work has commenced:
 *     client/src/pages/terms-of-use.tsx section 6
 *   - nobody can promise rankings; the service agreement spells out what we deliver: client/src/pages/pricing.tsx
 *   - the request form: client/src/components/talk-to-sales.tsx → POST /api/seo-inquiry in server/routes.ts
 *   - part of the Complete Business Build: shared/cart-bundles.ts DFY_BUNDLE_PARTS
 * The spotlight and In Depth section:
 *   - ConstructHUB's software doesn't create or verify Google listings (Google does; this service can help), and
 *     the Google tools need a listing you have Owner or Manager access to: server/data/hub-knowledge.md
 *     (sections 6 "Honest limits" and 28 "Do I need a Google Business Profile?")
 *   - what a linked listing syncs (reviews, photos, services, performance): server/gbp/service.ts syncLocation,
 *     shared/feature-pages/gbp.ts; Profile Guard watches the fields you choose: shared/feature-pages/profileGuard.ts;
 *     Posts & Photos schedules posts and photos: shared/feature-pages/gbpContent.ts; Photo Optimizer renames,
 *     geotags and describes photos: shared/feature-pages/media.ts; Site Scan: shared/feature-pages/siteScan.ts
 *   - Site Scan's local checks (name, street address and phone matched against the linked profile; a page whose
 *     title or H1 names each synced service and service area): server/sitescan/audit.ts findings() ("nap-*", "gap-*")
 *   - GBP = the listing in Google Maps and Search; NAP = name, address and phone: server/data/hub-knowledge.md glossary
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
      body: "We set up your Business Profile and take it through Google's verification, then build the website: design, content, service pages and location pages.",
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
      icon: "hard-hat",
      title: "Service pages",
      body: "A page for each trade you offer, with its own title and heading.",
    },
    {
      icon: "map",
      title: "Location pages",
      body: "A page for each area you serve, with its own title and heading.",
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
  spotlight: {
    kicker: "After the Build",
    heading: { title: "A Verified Profile Opens Up ", em: "the Google Tools" },
    points: [
      "ConstructHUB's software doesn't create or verify Google listings. Google does that, and this service handles it for you.",
      "Once the listing is verified and you have Owner or Manager access, it can be linked to ConstructHUB to sync its reviews, photos, services and performance numbers.",
      "Site Scan can then check the finished website against the linked profile: your name, address and phone, and a page for each service and area.",
    ],
    panel: {
      label: "With a plan",
      title: "Tools that work with your new profile and site",
      items: [
        "Google Business Profile sync", "Profile Guard", "Google Reviews", "Posts & Photos", "Photo Optimizer",
        "GMB Ranking Grid", "Site Scan",
      ],
      note: "These are software in a ConstructHUB plan, priced on the Pricing page; the setup service doesn't include a plan.",
    },
  },
  audience: [
    {
      title: "New businesses with no web presence",
      body: "You're starting out and need a verified profile and a website before the first jobs come in.",
    },
    {
      title: "Contractors with an outdated site",
      body: "Your site doesn't list your trades or the areas you serve, and you want it rebuilt with a page for each.",
    },
    {
      title: "Owners without a Google listing",
      body: "Customers can't find you in Google Maps yet, and you'd rather not work through setup and verification yourself.",
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
      a: "It's quoted for your business by a sales rep rather than sold at a listed price. The rep confirms the scope and the price with you before you commit or pay. Fees are non-refundable once work has started, as our Terms of Use say.",
    },
    {
      q: "Will my business rank at the top of Google?",
      a: "Nobody can promise that: Google decides search rankings, and Google decides on verification too. We build the profile and the site, and your service agreement spells out exactly what we deliver.",
    },
    {
      q: "Is it part of a plan?",
      a: "No. It's work our team does, so no plan includes it. Once it's built, the ConstructHUB tools for your Business Profile and website come with a plan. It's also part of the Complete Business Build.",
    },
  ],
  // WRITING-GUIDE.md → "The In Depth section". Sources: DFY_SERVICES "website" (pricing-display.ts), the
  // hub-knowledge.md limits and glossary, server/sitescan/audit.ts findings() local checks, pricing.tsx, terms-of-use.tsx.
  inDepth: {
    heading: { title: "Contractor Website Design and Your Google Profile, ", em: "Explained" },
    paragraphs: [
      "When someone nearby searches for your trade, two things decide whether they find you: your Google Business " +
        "Profile, the listing that shows in Google Maps and Search with your hours, photos and reviews, and your " +
        "website. GMB & Website Setup is our team building both for you. GMB is short for Google My Business, the " +
        "profile's former name.",
      "We create the profile and take it through Google's verification. Verification is Google's own step, so Google " +
        "decides the method and the outcome. ConstructHUB's software can't create or verify a listing, which is why this " +
        "is a done-for-you service: once the listing is verified and you have Owner or Manager access, it can be linked " +
        "to the Google tools in a plan.",
      "The contractor website is built around how people search: a trade and a place. That's why it gets a service page " +
        "for each trade you offer and a location page for each area you serve, so each search has a page whose title and " +
        "main heading name it. Your business name, address and phone (NAP, for short) should read the same on the site " +
        "and the profile. Those are the same local checks ConstructHUB's Site Scan runs against a linked profile, so you " +
        "can check the finished site yourself.",
      "Photo optimization prepares your job photos for the profile and the website, and the posting calendar gives your " +
        "profile a schedule of Google posts. After handover you can keep both going with the Photo Optimizer and Posts & " +
        "Photos in a plan, or carry on without them.",
      "It is quoted by a sales rep, so sending the request is free and needs no account. The rep agrees the pages, the " +
        "profile work and the price with you before you commit or pay, and the fee is non-refundable once work starts. " +
        "Nobody can promise rankings, because Google decides them; your service agreement spells out what we deliver.",
    ],
  },
  related: ["seoAds", "gbp", "siteScan"],
  headings: {
    steps: { title: "From Request to Live Profile in ", em: "Four Steps" },
    cards: { title: "What We ", em: "Build" },
    faq: { title: "Before You ", em: "Send a Request" },
  },
  seo: {
    title: "Contractor Website & Google Profile Setup | ConstructHUB",
    description:
      "We create and verify your Google Business Profile and build your contractor website, with a page for each trade and service area. Quoted by a sales rep.",
  },
  sources: [
    "client/src/lib/pricing-display.ts",
    "client/src/pages/landing.tsx",
    "client/src/pages/pricing.tsx",
    "client/src/pages/terms-of-use.tsx",
    "client/src/components/talk-to-sales.tsx",
    "server/catalog.ts",
    "server/routes.ts",
    "server/data/hub-knowledge.md",
    "server/gbp/service.ts",
    "server/sitescan/audit.ts",
    "shared/feature-pages/gbp.ts",
    "shared/feature-pages/profileGuard.ts",
    "shared/feature-pages/gbpContent.ts",
    "shared/feature-pages/media.ts",
    "shared/cart-bundles.ts",
  ],
};

export default page;
