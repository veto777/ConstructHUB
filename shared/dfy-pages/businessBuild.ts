import type { DfyPage } from "./types";

/**
 * Complete Business Build — the done-for-you bundle (catalog id dfy_bundle).
 *
 * Every claim below is backed by the code in `sources`:
 *   - what it contains (formation + licensing, GBP + website, SEO + ads): shared/cart-bundles.ts DFY_BUNDLE_PARTS,
 *     client/src/lib/pricing-display.ts DFY_SERVICES "business-build"; each part is sold on its own too:
 *     server/catalog.ts DFY_CATALOG; the monthly SEO packages are not a part (DFY_BUNDLE_PARTS)
 *   - paid upfront, 4–6 months from start to finish, excludes licensing exams and prerequisites, "from filing your
 *     LLC to launching your marketing", "ready to take jobs": client/src/pages/landing.tsx (Done-For-You section);
 *     "excludes licensing exams, prerequisites and required testing": client/src/lib/pricing-display.ts
 *   - quoted by a sales rep, never a listed price or an online checkout: server/catalog.ts isSalesOnly; scope and
 *     price confirmed before you commit or pay, fees non-refundable once work has commenced:
 *     client/src/pages/terms-of-use.tsx section 6
 *   - the request form: client/src/components/talk-to-sales.tsx → POST /api/seo-inquiry in server/routes.ts
 *   - the parts' own details: shared/dfy-pages/formation.ts, gmbWebsite.ts, seoAds.ts (and their sources)
 * The In Depth section:
 *   - Local Services Ads ask for proof of insurance, background checks, a linked Business Profile and trade licenses
 *     before ads go live: client/src/pages/lsa-guide.tsx section "verification"
 *   - license rules (and exams) differ by state: server/data/state-guides.json `licensing_required`, `licensing_notes`
 *   - ConstructHUB's software doesn't create or verify listings; Google verifies: server/data/hub-knowledge.md
 *   - nobody can promise rankings: client/src/pages/pricing.tsx
 */
const page: DfyPage = {
  key: "businessBuild",
  slug: "complete-business-build",
  status: "ready",
  title: "Complete Business Build",
  ctaTitle: "the Complete Business Build",
  kicker: "Turnkey business",
  headline: { lead: "Your Contracting Business, Built ", swipe: "Start to Finish" },
  lede:
    "Formation and licensing, your Google Business Profile and website, and SEO and ad campaigns in one engagement, " +
    "paid upfront and planned for 4–6 months from start to finish. The licensing exams stay with you.",
  hero: { mascot: "standing", bubble: "Bring the skills. We'll build the business around them." },
  catalogIds: ["dfy_bundle"],
  icon: "hard-hat",
  blurb: "Formation, profile, website and marketing in one",
  steps: [
    {
      title: "Tell us about the business",
      body: "Send the sales request with your name, email and what you're building. It's free and needs no account.",
    },
    {
      title: "Agree the scope and price",
      body: "A sales rep confirms the scope and the price with you; the build is one engagement, paid upfront.",
    },
    {
      title: "We build it",
      body: "Your company and license paperwork, your Business Profile and website, then your SEO and ad campaigns.",
    },
    {
      title: "Handover",
      body: "The build is planned for 4–6 months; the state's processing, Google's verification and your licensing exams can move that.",
    },
  ],
  cards: [
    {
      icon: "building",
      title: "Company formation & tax IDs",
      body: "Your LLC or corporation with the Secretary of State, your EIN and state tax ID, and business bank guidance.",
    },
    {
      icon: "clipboard",
      title: "Contractor license, bond & insurance",
      body: "The license application paperwork, surety bond setup, and general liability, auto and workers' comp.",
    },
    {
      icon: "map-pin",
      title: "Google Business Profile",
      body: "Your Business Profile created and taken through Google's verification, with photos and a posting calendar.",
    },
    {
      icon: "globe",
      title: "Contractor website",
      body: "Design and content, with a service page for each trade and a location page for each area you serve.",
    },
    {
      icon: "search",
      title: "Local SEO & schema",
      body: "Local SEO strategy and work, schema markup, and Search Console and Analytics set up.",
    },
    {
      icon: "megaphone",
      title: "Google Ads & Local Services Ads",
      body: "Google Ads campaigns set up and optimized, and your Local Services Ads enrollment.",
    },
  ],
  audience: [
    {
      title: "Contractors starting from scratch",
      body: "You have the trade skills and want the company, the web presence and the marketing built around you.",
    },
    {
      title: "Owners who'd rather hand it all off",
      body: "You don't want to do the setup yourself and would rather have one team handle every part of it.",
    },
  ],
  pricing: {
    kind: "sales",
    topic: "Complete Business Build",
    note: "One engagement, paid upfront once a rep has confirmed the scope and the price with you.",
  },
  faqs: [
    {
      q: "What's included?",
      a: "Business formation and your contractor license paperwork, your Google Business Profile and website, and SEO and ad campaigns, in one engagement.",
    },
    {
      q: "How long does it take?",
      a: "It's planned for 4–6 months from start to finish, and other parties' steps can move that. The rep goes through the timeline with you when scoping the build; your licensing exams aren't part of it.",
    },
    {
      q: "How is it paid?",
      a: "Upfront, as one engagement, after a sales rep confirms the scope and the price with you. Done-for-you service fees are non-refundable once work has started, as our Terms of Use say.",
    },
    {
      q: "What isn't included?",
      a: "Licensing exams, prerequisites and required testing. Those are yours to complete; we handle the paperwork around them. Monthly SEO packages are separate too.",
    },
    {
      q: "Can I get just one part?",
      a: "Yes. Business Formation & Filing, GMB & Website Setup and SEO & Ad Campaigns are each available on their own, quoted by a sales rep.",
    },
  ],
  // WRITING-GUIDE.md → "The In Depth section". Sources: DFY_BUNDLE_PARTS (cart-bundles.ts), DFY_SERVICES
  // "business-build", the landing Done-For-You section, lsa-guide.tsx "verification", state-guides.json, hub-knowledge.md.
  inDepth: {
    heading: { title: "A Turnkey Contracting Business, ", em: "Explained" },
    paragraphs: [
      "Turnkey means the setup is done for you and you get back a business that's ready to take jobs. The Complete " +
        "Business Build puts three of our services into one engagement: Business Formation & Filing, GMB & Website " +
        "Setup, and SEO & Ad Campaigns. Each is also sold on its own; the build is for contractors who want all three " +
        "done by one team, from filing the LLC to launching the marketing.",
      "The order matters. The company comes first: the LLC or corporation with the Secretary of State, the contractor " +
        "license application, the surety bond and insurance setup, and the EIN and state tax ID. The Google Business " +
        "Profile and the website are then built for that business, with a service page for each trade and a location " +
        "page for each area you serve. Marketing runs on top of both: local SEO, schema markup, Search Console and " +
        "Analytics, Google Ads campaigns and Local Services Ads enrollment.",
      "The order also fits what Google asks for. Before Local Services Ads go live, Google wants proof of insurance, " +
        "background checks, a linked Business Profile and your trade licenses. So the paperwork and the profile are in " +
        "place before the ads are switched on.",
      "From start to finish the build is planned for 4–6 months. Some steps run on other people's clocks: the state processes " +
        "your license application, Google verifies your profile, and the licensing exams, prerequisites and required " +
        "testing are yours to complete, since nobody can take them for you. License rules differ by state, and some " +
        "states have no state general contractor license at all, so the rep scopes the build for where you work.",
      "The build is quoted by a sales rep and paid upfront as one engagement once the scope and the price are agreed. " +
        "Done-for-you fees are non-refundable once work starts. Ongoing monthly SEO packages are separate, and nobody " +
        "can promise rankings, because Google decides them.",
    ],
  },
  related: ["formation", "gmbWebsite", "seoAds"],
  headings: {
    steps: { title: "From Request to Handover in ", em: "Four Steps" },
    cards: { title: "Everything in ", em: "One Build" },
    faq: { title: "Before You ", em: "Send a Request" },
  },
  seo: {
    title: "Start a Contracting Business, Done for You | ConstructHUB",
    description:
      "Your LLC and license paperwork, Business Profile, website, SEO and ads in one engagement, paid upfront, planned for 4–6 months. Quoted by a sales rep.",
  },
  sources: [
    "shared/cart-bundles.ts",
    "client/src/lib/pricing-display.ts",
    "client/src/pages/landing.tsx",
    "client/src/pages/pricing.tsx",
    "client/src/pages/terms-of-use.tsx",
    "client/src/pages/lsa-guide.tsx",
    "client/src/components/talk-to-sales.tsx",
    "server/catalog.ts",
    "server/routes.ts",
    "server/data/state-guides.json",
    "server/data/hub-knowledge.md",
    "shared/dfy-pages/formation.ts",
    "shared/dfy-pages/gmbWebsite.ts",
    "shared/dfy-pages/seoAds.ts",
  ],
};

export default page;
