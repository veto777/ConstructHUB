import type { FeaturePage } from "./types";

/**
 * Master Class — the contractor business course.
 *
 * Every claim below is backed by the code in `sources`:
 *   - the tabs (Overview, State Guide, Website & SEO, Vetting, Pricing), what the free overview shows
 *     (states that require a license, the quick state comparison) and what stays locked:
 *     client/src/pages/master-class.tsx (MASTER_CLASS_TABS, isTabUnlocked, PaywallOverlay, AgencyTile)
 *   - the four modules and their titles: server/data/master-class-modules.json (seeded by server/seed-reference-data.ts)
 *   - 50 state guides with agency links and link-check status (verified / unconfirmed / dead → web search):
 *     server/data/state-guides.json, server/state-guides-schema.ts, scripts/verify-state-guides.ts
 *   - any course purchase unlocks the Google Ads guide sections (server-enforced 403 otherwise): server/routes.ts
 *     (/api/google-ads-guide/:slug), client/src/pages/google-ads-guide.tsx
 *   - every module and the bundle are at or above the sales threshold → "Talk to a sales rep", no online checkout:
 *     server/catalog.ts (COURSE_BUNDLE, isSalesOnly), server/stripe.ts (create-course-checkout), shared/plans.ts (showsPrice)
 *   - purchases belong to the signed-in account (course_purchases.user_id): shared/schema.ts; the dashboard tile's
 *     "Modules unlocked": server/dashboard/tiles/learn.ts
 */

const page: FeaturePage = {
  key: "masterClass",
  slug: "master-class",
  group: "learn",
  status: "ready",
  title: "Master Class",
  kicker: "Contractor course",
  headline: { lead: "The Business Side of Contracting, ", swipe: "Step by Step" },
  lede:
    "A course on starting and growing a construction company: forming the business, licensing and insurance in your state, " +
    "your website and local search, and what homeowners check before they hire. Read the overview free, then unlock the modules you want.",
  hero: { mascot: "standing", bubble: "Licenses, websites, reviews. Let's take it one step at a time." },
  steps: [
    {
      title: "Read the free overview",
      body: "Open the Master Class to see the curriculum, which states require a state contractor license, and a comparison table of every state.",
    },
    {
      title: "Choose your modules",
      body: "Pick the modules you need, or the complete bundle of all four. A sales rep quotes them for your business.",
    },
    {
      title: "Unlock the course",
      body: "Your purchase is recorded on your ConstructHUB account and opens the course sections it covers. Any purchase also opens the full Google Ads guide.",
    },
    {
      title: "Work through your state",
      body: "Pick your state for its guide: the agencies to form, license, insure and register your business, with links that are checked.",
    },
  ],
  cards: [
    {
      icon: "graduation",
      title: "Four modules",
      body: "Business Formation & Licensing, GMB Setup & Optimization, Website & Online Presence, and SEO & Directory Domination. Buy one at a time or all four as the complete bundle.",
    },
    {
      icon: "map",
      title: "A guide for all 50 states",
      body: "Each state's Secretary of State, licensing board, workers' comp agency and tax agency, with notes on licensing, bonds, insurance and payroll.",
    },
    {
      icon: "link",
      title: "Agency links that are checked",
      body: "Links are checked and show when they were last checked. One the check couldn't confirm is marked unconfirmed; one that failed becomes a web search, never a guess.",
    },
    {
      icon: "globe",
      title: "Website & SEO",
      body: "A site that ranks, location pages, Search Console, page speed, tracking, backlinks, content, structured data, mobile design, reputation and email follow-up.",
    },
    {
      icon: "users",
      title: "Vetting contractors",
      body: "The checks homeowners use before they hire, a homeowner's checklist, and how to build a credible brand the honest way.",
    },
    {
      icon: "megaphone",
      title: "Google Ads guide included",
      body: "Any Master Class purchase unlocks all 12 sections of the Google Ads guide, from campaign setup and keywords to tracking and a launch checklist.",
    },
  ],
  spotlight: {
    kicker: "State Guides",
    heading: { title: "Every State's Agencies ", em: "in One Place" },
    points: [
      "Pick a state to see whether it requires a state contractor license, a bond, or sales tax on labor.",
      "The comparison table puts every state's license, workers' comp, sales tax and B&O tax side by side, free to read.",
      "Unlocked, each agency tile opens the agency's own site, and a link our check couldn't confirm says so.",
      "Some states have a detailed step-by-step walkthrough; more are being added state by state.",
    ],
    panel: {
      label: "State guide",
      title: "What each state guide covers",
      items: [
        "State overview", "Secretary of State", "Licensing board", "Workers' comp agency", "Tax agency", "Entity types",
        "Workers' comp type", "Sales tax on labor", "Contractor bond", "Licensing details", "Insurance notes", "Payroll notes",
      ],
      note: "The full state guide unlocks with the Business Formation & Licensing module or the bundle.",
    },
  },
  audience: [
    {
      title: "Contractors starting their own company",
      body: "You know the trade and want the business side right: entity, license, bond, insurance and taxes for your state.",
    },
    {
      title: "Companies expanding to another state",
      body: "Compare states side by side, then open each state's guide for its agencies and requirements.",
    },
    {
      title: "Owners who want more work online",
      body: "Your website, local search and Google Ads, with the full Google Ads guide included.",
    },
  ],
  pricing: {
    kind: "sales",
    topic: "The Master Class",
    note: "It is not part of any plan: buy the modules you want, or the complete bundle of all four.",
  },
  faqs: [
    {
      q: "What can I read before I buy?",
      a: "The course overview: the curriculum, the states that require a state contractor license, and a comparison table of every state. Pick a state to see whether it needs a license or a bond. Each state's full guide, its agency links and the course sections stay locked until you buy.",
    },
    {
      q: "How is it sold? Is it in my plan?",
      a: "No plan includes it. The four modules are sold one at a time or as the complete bundle, and a sales rep quotes them. The course unlocks on your ConstructHUB account, and any Master Class purchase also unlocks the full Google Ads guide.",
    },
    {
      q: "How current are the state guides?",
      a: "The agency links are checked by an automated link check, and each guide shows when its links were last checked. A link the check couldn't confirm is marked unconfirmed, and one that failed is replaced by a web search for the agency.",
    },
    {
      q: "What doesn't it do?",
      a: "It's a course, not legal, tax or licensing advice, and it doesn't file anything for you. Requirements change, so confirm them with the state agency before you file. It doesn't promise rankings, leads or results.",
    },
  ],
  related: ["guides", "gbp", "siteScan"],
  app: { href: "/master-class", surface: "app", label: "Open the Master Class" },
  tryIt: { label: "Read the free course overview", href: "/master-class" },
  headings: {
    steps: { title: "From Overview to Your State's Guide in ", em: "Four\u00a0Steps" },
    cards: { title: "What the Course ", em: "Covers" },
    faq: { title: "Before You ", em: "Enroll" },
  },
  seo: {
    title: "Master Class — Contractor Business Course | ConstructHUB",
    description:
      "A course on the business side of contracting: forming your company, licensing in all 50 states, your website and local search, plus the Google Ads guide.",
  },
  legacyPath: "/master-class-landing",
  sources: [
    "client/src/pages/master-class.tsx",
    "client/src/pages/google-ads-guide.tsx",
    "server/data/master-class-modules.json",
    "server/data/state-guides.json",
    "server/state-guides-schema.ts",
    "scripts/verify-state-guides.ts",
    "server/routes.ts",
    "server/catalog.ts",
    "server/stripe.ts",
    "server/dashboard/tiles/learn.ts",
    "shared/schema.ts",
    "shared/plans.ts",
  ],
};

export default page;
