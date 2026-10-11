import type { FeaturePage } from "./types";
import { planNamesWhere } from "../plan-copy";

/**
 * Master Class — the contractor business course.
 *
 * Every claim below is backed by the code in `sources`:
 *   - the tabs — Overview, the four module homes (State guide, Google Business, Website, SEO & ads), Vetting,
 *     Enroll — what the free overview shows (states that require a license, the state comparison) and what stays
 *     locked: client/src/pages/master-class.tsx, client/src/components/master-class/access.ts (tabUnlocked)
 *   - the four modules and their titles: server/data/master-class-modules.json (seeded by server/seed-reference-data.ts);
 *     a purchase opens the module whose category it bought: server/state-guides.ts (courseUnlocks)
 *   - the paid guide is served only to an entitled account (401/403 otherwise); the list route carries the free
 *     comparison facts only: server/routes.ts (/api/state-guides*), server/state-guides.ts (publicStateGuide)
 *   - 50 state guides with agency links and link-check status (verified / unconfirmed / dead → web search):
 *     server/data/state-guides.json, server/state-guides-schema.ts, scripts/verify-state-guides.ts
 *   - the written walkthroughs on file (Washington, Florida): server/data/state-guide-steps.json; every other state's
 *     ordered checklist is built from its agency record alone: server/state-guides.ts (agencyChecklist)
 *   - lessons with an outline, durable #lesson anchors and "Mark done" kept in the browser:
 *     client/src/components/master-class/lesson.tsx, client/src/components/guides/progress.ts
 *   - the lesson bodies are served only to an entitled account (401 signed out / 403 without the module, the bundle
 *     or an included course) and ship in no client bundle: server/master-class/routes.ts, server/master-class/lessons.ts,
 *     server/master-class/content/*; the client renders them from blocks: client/src/components/master-class/lesson-body.tsx
 *   - any course purchase unlocks the Google Ads guide sections (server-enforced 403 otherwise): server/routes.ts
 *     (/api/google-ads-guide/:slug), client/src/pages/google-ads-guide.tsx
 *   - every module and the bundle are at or above the sales threshold → "Talk to a sales rep", no online checkout;
 *     the page reads the bundle's price from the server catalog: server/catalog.ts (COURSE_BUNDLE, isSalesOnly),
 *     server/routes.ts (/api/course-catalog), server/stripe.ts (create-course-checkout), shared/plans.ts (showsPrice)
 *   - the plan that includes the course: shared/plans.ts (PlanModules.masterClass), read through planNamesWhere
 *   - purchases belong to the signed-in account (course_purchases.user_id): shared/schema.ts; the dashboard tile's
 *     "Modules unlocked": server/dashboard/tiles/learn.ts
 */

/** The plans whose modules include the Master Class — read from the price book, never typed. */
const INCLUDED_PLAN = planNamesWhere((p) => p.modules.masterClass);

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
      body: `Pick the modules you need, or the complete bundle of all four. A sales rep quotes them for your business; the ${INCLUDED_PLAN} plan includes the whole course.`,
    },
    {
      title: "Unlock the course",
      body: "Your purchase is recorded on your ConstructHUB account and opens the module it covers, lesson by lesson, with an outline and a Mark done on each. The lesson text is sent to your account only once it is unlocked. Any purchase also opens the full Google Ads guide.",
    },
    {
      title: "Work through your state",
      body: "Pick your state for its guide: the agencies to form, license, insure and register your business, with links that are checked, in an ordered checklist you tick off.",
    },
  ],
  cards: [
    {
      icon: "graduation",
      title: "Four modules",
      body: "Business Formation & Licensing, GMB Setup & Optimization, Website & Online Presence, and SEO & Directory Domination — each its own home of ordered lessons. Buy one at a time or all four as the complete bundle.",
    },
    {
      icon: "map",
      title: "A guide for all 50 states",
      body: "Each state's Secretary of State, workers' comp agency and tax agency, plus its licensing board where the state licenses contractors, with notes on licensing, bonds, insurance and payroll — ordered into a checklist built from that record. Washington and Florida also have a written step-by-step walkthrough.",
    },
    {
      icon: "link",
      title: "Agency links that are checked",
      body: "Links are checked and show when they were last checked. One the check couldn't confirm is marked unconfirmed; one that failed becomes a web search, never a guess.",
    },
    {
      icon: "map-pin",
      title: "Google Business Profile",
      body: "Claim and verify the profile, keep its details consistent, a photo habit, reviews asked for and answered the compliant way, fake-review defence, posting cadence, suspension prevention and recovery, and measuring your map rank.",
    },
    {
      icon: "globe",
      title: "Website, SEO and ads",
      body: "The pages a contractor site needs, location pages, speed, mobile, portfolio, schema and ownership; then Search Console, tracking, content, backlinks, citations, social, Google Ads and LSA, and a monthly maintenance checklist.",
    },
    {
      icon: "users",
      title: "Vetting contractors",
      body: "The checks homeowners use before they hire, a homeowner's checklist you tick off, and how to build a credible brand the honest way. Included with any module.",
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
      "Every state's agencies are ordered into a checklist you tick off; Washington and Florida also have a written step-by-step walkthrough, and the page says which one you are reading.",
    ],
    panel: {
      label: "State guide",
      title: "What each state guide covers",
      items: [
        "State overview", "Secretary of State", "Licensing board (where one exists)", "Workers' comp agency", "Tax agency", "Entity types",
        "Workers' comp type", "Sales tax on labor", "Contractor bond", "Licensing details", "Insurance notes", "Payroll notes", "Ordered checklist",
      ],
      note: `The full state guide unlocks with the Business Formation & Licensing module or the bundle, and is included with the ${INCLUDED_PLAN} plan.`,
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
    note: `The ${INCLUDED_PLAN} plan includes it. On any other plan, buy the modules you want, or the complete bundle of all four.`,
  },
  faqs: [
    {
      q: "What can I read before I buy?",
      a: "The course overview: the curriculum, each module's lesson outline, the states that require a state contractor license, and a comparison table of every state. Pick a state to see whether it needs a license or a bond. Each state's full guide, its agency links and the lessons stay locked until you buy.",
    },
    {
      q: "How is it sold? Is it in my plan?",
      a: `The ${INCLUDED_PLAN} plan includes the whole course. On any other plan the four modules are sold one at a time or as the complete bundle, and a sales rep quotes them. The course unlocks on your ConstructHUB account, and any Master Class purchase also unlocks the full Google Ads guide.`,
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
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): the order of the course and what each state
  // guide records are server/data/state-guides.json (its fields) and master-class.tsx (the State Guide tab, AgencyTile);
  // the local/trade licensing notes are the licensing_notes of the 18 states with licensing_required false; the link
  // policy is scripts/verify-state-guides.ts checkAgencyUrl() and AgencyTile (dead/none → web search, unconfirmed
  // labelled, "Link checked" date); the free overview is the overview tab (license lists, Quick State Comparison);
  // the sales-rep sale is server/catalog.ts isSalesOnly + server/stripe.ts create-course-checkout; the purchase on the
  // account is course_purchases.user_id (shared/schema.ts) read by /api/course-purchases (server/routes.ts).
  inDepth: {
    heading: { title: "Starting a Construction Company, ", em: "State by State" },
    paragraphs: [
      "The Master Class is a contractor business course for people who know the trade and want the business side set " +
        "up right. It follows the order a new company usually goes in: form the business with your state, get " +
        "licensed where the state requires it, sort out insurance, workers' comp, taxes and payroll, then build the " +
        "website and local search presence that bring in calls.",
      "Contractor license requirements differ from state to state, so the course keeps one guide for each of the 50 " +
        "states. A guide names the state's business filing office, its workers' comp agency, its tax agency and, where " +
        "the state licenses contractors, its licensing board. It records whether a statewide contractor license is " +
        "required, whether a contractor bond is required and the general contractor bond amount on file, how workers' comp is bought " +
        "there (private insurers, a state fund, or either), whether sales tax applies to labor, whether the state " +
        "charges a business and occupation (B&O) tax, and the business entity types you can form. Where there is no " +
        "statewide license, the licensing notes point to the trade licenses and city or county rules that may still apply. " +
        "Those records are ordered into a checklist for every state (form, license, bond, insure, taxes, payroll) that " +
        "says nothing the record doesn't; Washington and Florida also have a walkthrough written step by step, and the " +
        "page says which of the two you are reading.",
      "Agency websites move, so every agency link goes through a link check. A link counts as verified only when the " +
        "page loads, names the state and is about that agency's work: business filings, licensing, workers' comp or " +
        "taxes. When a government site blocks the check or the result is unclear, the link stays and is labelled " +
        "unconfirmed. A link that is gone, such as a missing page, a dead domain or a parked site, is removed, and the " +
        "tile searches the web for the agency instead. No agency address is ever guessed, and each tile shows the date " +
        "its link was last checked.",
      "Before you buy, the free overview shows which states require a state contractor license and a side-by-side " +
        "table of every state's license, workers' comp, sales tax on labor, B&O tax, bond and filing office. The " +
        "modules and the complete bundle are quoted by a sales rep rather than checked out online, the " +
        `${INCLUDED_PLAN} plan includes the course, and a purchase is ` +
        "recorded on your ConstructHUB account, so the module it unlocks opens wherever you sign in. Each module is a " +
        "home of ordered lessons with an outline; a lesson's link survives a reload, and Mark done keeps your place in " +
        "the browser you read it in.",
      "The course is education, not legal, tax or licensing advice, and nothing is filed for you. Rules and fees " +
        "change, so confirm the current requirements with the agency itself before you file, apply or pay.",
    ],
  },
  // Prices read on 2026-10-10 from: classes.mycontractoruniversity.com, thesoe.com/enroll.html, thecontractorfight.com,
  // btacademy.com (~/codex-audits/a-la-carte-competitors.md → master_class).
  compare: {
    alacarte: ["master_class"],
    checkedOn: "2026-10-10",
    competitors: [
      { name: "Contractor University", price: { kind: "monthly", cents: 36500 }, source: "https://classes.mycontractoruniversity.com/" },
      { name: "Contractor Nation", plan: "School of Entrepreneurship", price: { kind: "monthly", cents: 50000 }, note: "a lower first month", source: "https://www.thesoe.com/enroll.html" },
      { name: "The Contractor Fight", price: { kind: "one_time", cents: 240000 }, note: "a 90-day program; monthly coaching sold separately", source: "https://thecontractorfight.com/" },
      { name: "Breakthrough Academy", price: { kind: "one_time", cents: 570000 }, note: "plus monthly coaching", source: "https://btacademy.com/" },
    ],
    onlyUs: [
      "A guide for all 50 states — Secretary of State, licensing board, workers' comp, tax, bonds — with agency links that are checked and dated.",
      "A free state comparison table before you buy anything.",
      "Website, SEO, Google Business Profile and Google Ads in one course.",
    ],
    theyNotUs: "Live coaching and a community.",
    oneOfAKind: "As a 50-state licensing and marketing course, we found nothing else like it.",
  },
  related: ["guides", "gbp", "siteScan"],
  app: { href: "/master-class", surface: "app", label: "Open the Master Class" },
  tryIt: { label: "Read the free course overview", href: "/master-class" },
  headings: {
    steps: { title: "From Overview to Your State's Guide in ", em: "Four\u00a0Steps" },
    cards: { title: "What the Course ", em: "Covers" },
    faq: { title: "Before You ", em: "Enroll" },
  },
  seo: {
    title: "Start a Construction Company — Master Class | ConstructHUB",
    description:
      "A contractor business course: forming your company, contractor license requirements in all 50 states, insurance, taxes, your website and local SEO.",
  },
  legacyPath: "/master-class-landing",
  sources: [
    "client/src/pages/master-class.tsx",
    "client/src/components/master-class/access.ts",
    "client/src/components/master-class/lesson.tsx",
    "client/src/components/master-class/lesson-body.tsx",
    "client/src/components/guides/progress.ts",
    "client/src/pages/google-ads-guide.tsx",
    "server/data/master-class-modules.json",
    "server/data/state-guides.json",
    "server/data/state-guide-steps.json",
    "server/state-guides.ts",
    "server/master-class/routes.ts",
    "server/master-class/lessons.ts",
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
