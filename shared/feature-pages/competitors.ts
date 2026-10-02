import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { ADDONS, PLANS } from "../plans";
import { joinNames, plansWhere } from "../plan-copy";

/**
 * Competitor Intel — public market research from Google's business listings.
 * Google re-audits sensitive-scope apps: keep the wording about PUBLIC listings and benchmarking
 * (client/src/lib/features.ts), never "spy". Public Ad Activity is OFF (SHOW_AD_ACTIVITY = false,
 * /api/ad-spy answers 410), so nothing here mentions ads except to say it doesn't show them.
 *
 * Every claim below is backed by the code in `sources`:
 *   - trade list, location, radius 10/25/50/100, scan list, delete, per-band totals, listings sorted by rating:
 *     client/src/pages/competitors.tsx; server/routes.ts GET/POST/DELETE /api/competitors/scans
 *   - Google Places text search, up to 3 result pages, kept inside the radius; "may be incomplete" note when a
 *     later page fails: server/competitor-provider.ts competitorPlaces; server/routes.ts runCompetitorScan
 *   - per listing: name, address, phone, website, rating, review count, category: runCompetitorScan
 *   - BS Meter 0–100 + reasons, review-sample breakdown, "not proof", velocity unavailable from a sample:
 *     server/competitor-analysis.ts analyzeReviews / analyzeBsScore / presentListing
 *   - a failed scan gives its scan back: runCompetitorScan → refundReservation
 *   - plan gate (competitorScans > 0) + monthly quota + the scan-pack add-on: server/routes.ts
 *     requireCompetitorIntel, server/growth-quotas.ts METERS.competitorScans, shared/plans.ts
 */

const SCANS: FeatureAllowance = { limit: "competitorScans", unit: "Competitor Intel scans", period: "month" };
const PACK = ADDONS.competitor_pack;
const FIRST_PLAN = PLANS[plansWhere((plan) => plan.limits.competitorScans > 0)[0]].name;
const PACK_PLANS = joinNames(PACK.availableOn.map((key) => PLANS[key].name));

const page: FeaturePage = {
  key: "competitors",
  slug: "competitors",
  group: "win",
  status: "ready",
  title: "Competitor Intel",
  kicker: "Market research",
  headline: { lead: "Size Up the Competition ", swipe: "in\u00a0Your\u00a0Area" },
  lede:
    "Competitor Intel looks up the businesses Google lists for your trade around your town and lays out each one's " +
    "public rating, review count, phone and website, with a careful look at a sample of their reviews.",
  hero: { mascot: "standing", bubble: "Let's see who else shows up for your trade." },
  steps: [
    {
      title: "Pick your trade and area",
      body: "Choose your trade from the list, enter a city or an address, and set a radius of 10, 25, 50 or 100 miles.",
    },
    {
      title: "It reads public listings",
      body: "It searches Google's public business listings for your trade around that spot and keeps the ones inside your radius.",
    },
    {
      title: "Read the market",
      body: "Each business's rating, review count, address, phone, website and category, sorted by rating, with notes on its review sample.",
    },
    {
      title: "Keep the scan",
      body: "Every scan is saved to your account to reopen later or delete. Run a new scan whenever you want today's picture.",
    },
  ],
  cards: [
    {
      icon: "map-pin",
      title: "Your trade, your radius",
      body: "Common contractor trades, from roofing and siding to HVAC, plumbing and remodeling, within 10, 25, 50 or 100 miles.",
    },
    {
      icon: "list",
      title: "Every listing in one view",
      body: "Business name, address, phone, website, rating, review count and category for each business found.",
    },
    {
      icon: "gauge",
      title: "BS Meter",
      body: "A 0 to 100 heuristic score of signals worth a closer look, like a keyword-stuffed name or stock phrases in the review sample, with every reason listed.",
    },
    {
      icon: "star",
      title: "Review sample breakdown",
      body: "From the reviews Google returns: positive and negative, reviews with photos, generic wording and repeated common phrases.",
    },
    {
      icon: "history",
      title: "Saved scans",
      body: "Scans stay on your account to reopen or delete, with a count of how many businesses fall into each signal band.",
    },
    {
      icon: "refresh",
      title: "Failed scans don't count",
      body: "If a scan can't finish, it is given back to your monthly allowance.",
    },
  ],
  spotlight: {
    kicker: "The BS Meter",
    heading: { title: "Signals, Not ", em: "Verdicts" },
    points: [
      "It reads the sample of reviews Google returns for a listing, not every review the business has.",
      "A score points you at patterns worth a closer look. It is not proof that reviews are fake, bought or written by AI.",
      "How fast reviews arrive can't be measured from a sample, so it isn't scored.",
      "Each listing shows the reasons behind its score, so you can judge them yourself.",
    ],
    panel: {
      label: "Each listing",
      title: "What every listing holds",
      items: [
        "Business name", "Address", "Phone", "Website", "Rating", "Review count", "Category",
        "BS Meter score", "Reasons for the score", "Review sample breakdown",
      ],
      note: "From Google's public listing data on the day you run the scan.",
    },
  },
  audience: [
    {
      title: "Owners moving into a new area",
      body: "See how many businesses already serve your trade there and how they're rated.",
    },
    {
      title: "Contractors working on reviews",
      body: "Use the ratings and review counts around you as a benchmark for your own profile.",
    },
    {
      title: "Agencies planning for a client",
      body: "Show a client their local market from public listing data.",
    },
  ],
  pricing: {
    kind: "allowance",
    allowance: SCANS,
    note: `Each scan uses one from the allowance. The ${PACK.name} add-on adds more scans a month on the ${PACK_PLANS} plans.`,
  },
  faqs: [
    {
      q: "What do I need to run a scan?",
      a: "Just your trade and a city or address. There's nothing to connect: Competitor Intel reads Google's public business listings, not anyone's private account.",
    },
    {
      q: "Which plans include it, and how many scans do I get?",
      a: `It's included from the ${FIRST_PLAN} plan. ${allowanceLine(SCANS)}. The ${PACK.name} add-on adds ${PACK.grants.competitorScans} more scans a month on the ${PACK_PLANS} plans.`,
    },
    {
      q: "Does the BS Meter prove a competitor's reviews are fake?",
      a: "No. It flags patterns in a small sample of reviews that are worth a closer look. It can't tell whether a review is genuine, bought or written by AI, and a high score is not evidence of wrongdoing.",
    },
    {
      q: "How many businesses does one scan find?",
      a: "As many as Google's listing search returns for your trade in that area, up to three pages of results, that fall inside your radius. If a later page fails to load, the scan says the list may be incomplete.",
    },
    {
      q: "What doesn't it do?",
      a: "It doesn't show competitors' ads, ad spend, search rankings or private account data, and it doesn't watch the market between scans. Each scan is a snapshot of public listings on the day you run it.",
    },
  ],
  related: ["rankingGrid", "reviews", "gbp"],
  app: { href: "/competitors", surface: "app" },
  headings: {
    steps: { title: "From Trade and Town to a Market View in ", em: "Four\u00a0Steps" },
    cards: { title: "What Every Scan ", em: "Gives You" },
    faq: { title: "Before You ", em: "Run a Scan" },
  },
  seo: {
    title: "Competitor Intel — Local Market Research | ConstructHUB",
    description:
      "See the businesses Google lists for your trade within 10 to 100 miles: ratings, review counts, phones and websites, plus a careful look at each review sample.",
  },
  legacyPath: "/competitors-landing",
  flag: "SHOW_COMPETITOR_INTEL",
  sources: [
    "client/src/pages/competitors.tsx",
    "client/src/pages/competitors-landing.tsx",
    "client/src/lib/features.ts",
    "server/routes.ts",
    "server/competitor-analysis.ts",
    "server/competitor-provider.ts",
    "server/growth-quotas.ts",
    "shared/plans.ts",
  ],
};

export default page;
