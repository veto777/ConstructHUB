import type { DfyPage } from "./types";

/**
 * Business Formation & Filing — done-for-you (catalog id dfy_formation).
 *
 * Every claim below is backed by the code in `sources`:
 *   - what the service covers (formation with the Secretary of State, the license application, surety bond and
 *     insurance setup incl. GL / auto / workers' comp, EIN, state tax ID and business bank guidance):
 *     client/src/lib/pricing-display.ts DFY_SERVICES "formation"; the landing card's list: client/src/pages/landing.tsx
 *     (#done-for-you, "LLC, licensing paperwork, bonding, insurance processing, tax registration")
 *   - quoted by a sales rep, never a listed price or an online checkout (priced at or above the sales threshold):
 *     server/catalog.ts DFY_CATALOG + isSalesOnly; checkout refuses it: server/stripe.ts (sendTalkToSales);
 *     the scope and price are confirmed before you commit or pay and the fees are non-refundable once work has
 *     commenced: client/src/pages/terms-of-use.tsx section 6
 *   - licensing exams, prerequisites and required testing are the one thing we can't do: client/src/pages/pricing.tsx
 *     (services intro), client/src/lib/pricing-display.ts ("Excludes licensing exams, prerequisites and required
 *     testing"), client/src/pages/landing.tsx ("The only thing we can't do is take your licensing exams for you")
 *   - the request form (name, email, optional phone and company, what you need; no account; a rep replies by
 *     email): client/src/components/talk-to-sales.tsx → POST /api/seo-inquiry in server/routes.ts (seoInquiryInput)
 *   - part of the Complete Business Build: shared/cart-bundles.ts DFY_BUNDLE_PARTS
 *   - the Master Class module covering the same ground for do-it-yourselfers (Business Formation & Licensing,
 *     all 50 states, Secretary of State links, workers' comp per state): server/data/master-class-modules.json
 * The In Depth section's state-by-state facts come from the state guide data, server/data/state-guides.json:
 *   - entity types per state (LLC, corporation, LP, LLP, PLLC, series LLC, DBA): `entity_types`
 *   - the Secretary of State office has other names in some states (Alaska: "Division of Corporations"): `sos_name`
 *   - no state general contractor license in some states, local / trade licenses instead (TX, NY, OH notes;
 *     18 of 50 have `licensing_required: false`): `licensing_required`, `licensing_notes`
 *   - trade and law exams, fingerprinting in some states (CA, NV notes): `licensing_notes`
 *   - a bond required in some states, not others (15 of 50): `bond_required`
 *   - workers' comp from private carriers in most states, a state fund in a few: `workers_comp_type`
 *   - sales tax on labor in a few states, a B&O tax in Washington: `sales_tax_on_labor`, `b_and_o_tax`
 *   - EIN = the IRS's federal tax ID for a business: the plain-English definition of the term the service names.
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
      title: "Surety bond",
      body: "Setup for the surety bond your license calls for, where your state requires one.",
    },
    {
      icon: "shield-check",
      title: "Business insurance",
      body: "Insurance setup for general liability, auto and workers' comp.",
    },
    {
      icon: "receipt",
      title: "EIN and state tax ID",
      body: "Your federal EIN and your state tax ID, registered for the business.",
    },
    {
      icon: "wallet",
      title: "Business bank guidance",
      body: "Guidance on opening a business bank account for the new company.",
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
    {
      title: "Crews making it official",
      body: "You've been working under your own name and want a registered company, a license application and proper insurance behind you.",
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
  // WRITING-GUIDE.md → "The In Depth section". Sources: the header comment above (DFY_SERVICES "formation",
  // terms-of-use.tsx section 6, talk-to-sales.tsx, master-class-modules.json, and state-guides.json field by field).
  inDepth: {
    heading: { title: "How to Start a Contracting Business, ", em: "Explained" },
    paragraphs: [
      "Starting a contracting business takes three kinds of paperwork before the first job: the company itself, the " +
        "contractor license that lets you do the work, and the registrations that let you get insured, hire and get paid. " +
        "Business Formation & Filing is our team doing that filing for you. It is quoted by a sales rep for your business, " +
        "because what you need depends on your state, your trade and how you want the company set up.",
      "Company formation means registering your LLC or corporation with the Secretary of State, the state office that " +
        "keeps business records (some states call it the Division of Corporations). Then come the tax IDs: an EIN, the " +
        "federal tax ID the IRS issues to a business, and your state tax ID, plus guidance on opening a business bank " +
        "account so the company's money stays separate.",
      "Contractor licensing is where states differ most. Some states license general contractors statewide. Others, " +
        "Texas and New York among them, have no state general contractor license: cities set their own rules, and trades " +
        "such as electrical and plumbing are licensed separately. Some states also require a surety bond with the license, " +
        "and some need fingerprinting and trade and law exams. We process the license application paperwork; the exams, " +
        "prerequisites and required testing stay with you, because nobody can take them for you.",
      "Insurance setup covers general liability, commercial auto and workers' comp. In most states workers' comp comes " +
        "from private insurers; in a few it comes from a state fund. Sending the request is free and needs no account: a " +
        "rep replies by email, agrees the scope and the price with you before you commit or pay, and the fee is " +
        "non-refundable once work starts. If you'd rather do it yourself, the Master Class's Business Formation & " +
        "Licensing module walks through the same steps for every state.",
    ],
    bulletsIntro: "What changes from one state to the next:",
    bullets: [
      "Which business types you can form: LLC, corporation, LP, LLP, PLLC or series LLC",
      "Whether the state licenses general contractors, or leaves it to cities and specific trades",
      "Whether a surety bond is required, and for which licenses",
      "Where workers' comp comes from: private carriers, a state fund, or either",
      "Whether labor is taxed: a few states charge sales tax on labor, and Washington adds a B&O tax",
    ],
  },
  related: ["businessBuild", "gmbWebsite", "masterClass"],
  headings: {
    steps: { title: "From Request to Filing in ", em: "Four Steps" },
    cards: { title: "What We ", em: "Take Care Of" },
    faq: { title: "Before You ", em: "Send a Request" },
  },
  seo: {
    title: "Contractor License & LLC Filing, Done for You | ConstructHUB",
    description:
      "We form your LLC or corporation, process your contractor license application, and set up your bond, insurance, EIN and state tax ID. Quoted by a sales rep.",
  },
  sources: [
    "client/src/lib/pricing-display.ts",
    "client/src/pages/landing.tsx",
    "client/src/pages/pricing.tsx",
    "client/src/pages/terms-of-use.tsx",
    "client/src/components/talk-to-sales.tsx",
    "server/catalog.ts",
    "server/stripe.ts",
    "server/routes.ts",
    "server/data/state-guides.json",
    "server/data/master-class-modules.json",
    "shared/cart-bundles.ts",
  ],
};

export default page;
