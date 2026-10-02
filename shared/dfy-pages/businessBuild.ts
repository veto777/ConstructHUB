import type { DfyPage } from "./types";

/**
 * Complete Business Build — the done-for-you bundle (catalog id dfy_bundle).
 *
 * Every claim below is backed by the code in `sources`:
 *   - what it contains (formation + licensing, GBP + website, SEO + ads): shared/cart-bundles.ts DFY_BUNDLE_PARTS,
 *     client/src/lib/pricing-display.ts DFY_SERVICES "business-build"; each part is sold on its own too:
 *     server/catalog.ts DFY_CATALOG
 *   - paid upfront, 4–6 months from start to finish, excludes licensing exams and prerequisites, "ready to take
 *     jobs": client/src/pages/landing.tsx (Done-For-You section); "excludes licensing exams, prerequisites and
 *     required testing": client/src/lib/pricing-display.ts
 *   - quoted by a sales rep, never a listed price or an online checkout: server/catalog.ts isSalesOnly; scope and
 *     price confirmed before you commit or pay, fees non-refundable once work has commenced:
 *     client/src/pages/terms-of-use.tsx section 6
 *   - the request form: client/src/components/talk-to-sales.tsx → POST /api/seo-inquiry in server/routes.ts
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
    "paid upfront and done in 4–6 months from start to finish. The licensing exams stay with you.",
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
      title: "Ready to take jobs",
      body: "Start to finish takes 4–6 months. The licensing exams are the one part we can't do for you.",
    },
  ],
  cards: [
    {
      icon: "building",
      title: "Business formation & contractor license",
      body: "Formation with the Secretary of State, the license application, bond, insurance and tax IDs.",
    },
    {
      icon: "globe",
      title: "Google Business Profile & website",
      body: "A verified Business Profile and a contractor website with service and location pages.",
    },
    {
      icon: "megaphone",
      title: "SEO & ad campaigns",
      body: "Local SEO, Google Ads, Local Services Ads enrollment, schema markup, Search Console and Analytics.",
    },
    {
      icon: "clock",
      title: "4–6 months, start to finish",
      body: "One engagement from the first filing to running campaigns.",
    },
    {
      icon: "alert",
      title: "What it leaves out",
      body: "Licensing exams, prerequisites and required testing.",
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
      a: "4–6 months from start to finish.",
    },
    {
      q: "How is it paid?",
      a: "Upfront, as one engagement, after a sales rep confirms the scope and the price with you. Done-for-you service fees are non-refundable once work has started, as our Terms of Use say.",
    },
    {
      q: "What isn't included?",
      a: "Licensing exams, prerequisites and required testing. Those are yours to complete; we handle the paperwork around them.",
    },
    {
      q: "Can I get just one part?",
      a: "Yes. Business Formation & Filing, GMB & Website Setup and SEO & Ad Campaigns are each available on their own, quoted by a sales rep.",
    },
  ],
  related: ["formation", "gmbWebsite", "seoAds"],
  headings: {
    steps: { title: "From Request to Ready in ", em: "Four Steps" },
    cards: { title: "Everything in ", em: "One Build" },
  },
  seo: {
    title: "Complete Business Build for Contractors | ConstructHUB",
    description:
      "Formation and licensing, Google Business Profile and website, and SEO and ads in one engagement: paid upfront, 4–6 months start to finish. Quoted by a sales rep.",
  },
  sources: [
    "shared/cart-bundles.ts",
    "client/src/lib/pricing-display.ts",
    "client/src/pages/landing.tsx",
    "client/src/pages/terms-of-use.tsx",
    "client/src/components/talk-to-sales.tsx",
    "server/catalog.ts",
    "server/routes.ts",
  ],
};

export default page;
