import type { DfyPage } from "./types";

/**
 * Business Formation & Filing — done-for-you (catalog id dfy_formation).
 *
 * Every claim below is backed by the code in `sources`:
 *   - what the service covers (formation with the Secretary of State, the license application, surety bond and
 *     insurance setup incl. GL / auto / workers' comp, EIN, state tax ID and business bank guidance):
 *     client/src/lib/pricing-display.ts DFY_SERVICES "formation"; the landing card's list: client/src/pages/landing.tsx
 *   - quoted by a sales rep, never a listed price or an online checkout (priced at or above the sales threshold):
 *     server/catalog.ts DFY_CATALOG + isSalesOnly; the scope and price are confirmed before you commit or pay and the
 *     fees are non-refundable once work has commenced: client/src/pages/terms-of-use.tsx section 6
 *   - licensing exams are the one thing we can't do: client/src/pages/pricing.tsx (services intro) and the
 *     Complete Business Build's "Excludes licensing exams, prerequisites and required testing"
 *   - the request form (name, email, optional phone and company, what you need; no account; a rep replies by
 *     email): client/src/components/talk-to-sales.tsx → POST /api/seo-inquiry in server/routes.ts
 *   - part of the Complete Business Build: shared/cart-bundles.ts DFY_BUNDLE_PARTS
 */
const page: DfyPage = {
  key: "formation",
  slug: "business-formation",
  status: "ready",
  title: "Business Formation & Filing",
  kicker: "Done-for-you formation",
  headline: { lead: "Your Contracting Company, ", swipe: "Filed for You" },
  lede:
    "We file the paperwork to set up your company and apply for your contractor license: the formation, the license " +
    "application, your bond and insurance setup, and your tax IDs. A sales rep scopes it with you and quotes it for your business.",
  hero: { mascot: "standing", bubble: "Paperwork isn't your trade. Let us file it." },
  catalogIds: ["dfy_formation"],
  icon: "building",
  blurb: "LLC, license paperwork, bond, insurance and tax IDs",
  steps: [
    {
      title: "Tell us what you need",
      body: "Send the sales request with your name, email and what you're setting up. It's free and needs no account.",
    },
    {
      title: "Agree the scope and price",
      body: "A sales rep confirms what we'll file and what it costs with you before you commit or pay.",
    },
    {
      title: "We file the paperwork",
      body: "Formation, the license application, and the bond, insurance and tax registrations in the scope you agreed.",
    },
    {
      title: "You take the exams",
      body: "Licensing exams, prerequisites and required testing stay with you; they're the one part we can't do for you.",
    },
  ],
  cards: [
    {
      icon: "building",
      title: "Company formation",
      body: "Your LLC or corporation formed with the Secretary of State.",
    },
    {
      icon: "clipboard",
      title: "Contractor license application",
      body: "We process the paperwork for your contractor license application.",
    },
    {
      icon: "shield",
      title: "Surety bond and insurance",
      body: "Setup for your surety bond and your insurance: general liability, auto and workers' comp.",
    },
    {
      icon: "receipt",
      title: "Tax IDs and banking",
      body: "Your EIN and state tax ID, plus guidance on opening a business bank account.",
    },
  ],
  audience: [
    {
      title: "Contractors going out on their own",
      body: "You're starting your own company and want the formation and license paperwork handled while you keep working.",
    },
    {
      title: "Owners who'd rather not do the filing",
      body: "You know your trade and want someone else to work through the registrations, the bond and the insurance setup.",
    },
  ],
  pricing: {
    kind: "sales",
    topic: "Business formation and licensing",
    note: "Sending the request is free; a rep scopes the work and quotes it before you commit.",
  },
  faqs: [
    {
      q: "What do I need to start?",
      a: "Just the sales request: your name and email, and if you like your phone, your company and what you need. You don't need a ConstructHUB account. A rep replies by email to scope the work.",
    },
    {
      q: "How much does it cost?",
      a: "It's quoted for your business by a sales rep rather than sold at a listed price, and it isn't sold through online checkout. The rep confirms the scope and the price with you before you commit or pay.",
    },
    {
      q: "Will you take my licensing exam?",
      a: "No. Licensing exams, prerequisites and required testing are yours to complete. The service covers the paperwork around them.",
    },
    {
      q: "Is it part of a plan?",
      a: "No. It's work our team does, not software, so no plan includes it. It is part of the Complete Business Build, which adds your Google Business Profile, website and marketing.",
    },
    {
      q: "Can I get a refund once you start?",
      a: "Done-for-you service fees are non-refundable once work has started, as our Terms of Use say. That's why the scope and the price are agreed with you first.",
    },
  ],
  related: ["businessBuild", "gmbWebsite", "masterClass"],
  headings: {
    steps: { title: "From Request to Filing in ", em: "Four Steps" },
    cards: { title: "What We ", em: "Take Care Of" },
  },
  seo: {
    title: "Business Formation & Contractor Licensing | ConstructHUB",
    description:
      "We form your LLC or corporation, process your contractor license application, and set up your bond, insurance and tax IDs. Quoted by a sales rep.",
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
