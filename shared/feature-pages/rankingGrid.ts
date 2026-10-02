import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { gridCreditCost } from "../plans";

/**
 * GMB Ranking Grid — every claim is backed by the code in `sources`:
 *   - find the business by name or a Google Maps link (no Google connection): client/src/pages/ranking-grid.tsx
 *     → POST /api/photos/business-search (server/routes.ts, Places + the Maps-link resolver)
 *   - grid sizes 3×3…15×15, spacing 0.5–20 miles (server rejects above 20): ranking-grid.tsx GRID_SIZES /
 *     DISTANCE_OPTIONS, server/routes.ts POST /api/ranking-grid/scans validation
 *   - how a point is measured: Google Places text search for the keyword from that point, the business's position
 *     in the returned results, the top 5 businesses kept per point: server/routes.ts runRankingGridScan
 *   - cost = one credit per 25 points, rounded up; a failed grid refunds its credits; the card trial runs 1 grid:
 *     shared/plans.ts gridCreditCost, server/routes.ts (refundReservation, trialLive)
 *   - monthly credits per plan (Agency per location): shared/plans.ts gridCredits / gridCreditsPerLocation,
 *     server/growth-quotas.ts METERS.rankings
 *   - the report: pins coloured 1–3 / 4–10 / 11–20 / not found, Rank Summary (average, best, ranked / un-ranked,
 *     top-3 count, max distance), Rank Distribution, the businesses found most across the grid (found at, average
 *     rank, best rank), Print / PDF, Scan History: client/src/pages/ranking-grid.tsx
 */

const CREDITS: FeatureAllowance = {
  limit: "gridCredits", perLocation: "gridCreditsPerLocation", unit: "ranking-grid credits", period: "month",
};
const credits = (n: number) => `${gridCreditCost(n)} ${gridCreditCost(n) === 1 ? "credit" : "credits"}`;

const page: FeaturePage = {
  key: "rankingGrid",
  slug: "ranking-grid",
  group: "grow",
  status: "ready",
  title: "GMB Ranking Grid",
  kicker: "Local rankings",
  headline: { lead: "See Where You Rank, ", swipe: "Street by Street" },
  lede:
    "Pick your business and a search phrase. The GMB Ranking Grid runs that search from a grid of points across " +
    "your service area and maps where your business comes up at each one.",
  hero: { mascot: "standing", bubble: "Let's see how far your listing reaches." },
  steps: [
    {
      title: "Find your business",
      body: "Search by business name, or paste your Google Maps link. No Google account connection needed.",
    },
    {
      title: "Choose a keyword",
      body: "Enter the phrase a customer would search for, such as the service you sell.",
    },
    {
      title: "Size the grid",
      body: "Pick from a 3×3 to a 15×15 grid of points, spaced from half a mile to 20 miles apart. Bigger grids use more credits.",
    },
    {
      title: "Read the map",
      body: "Each point shows your position in the results from that spot, with a summary and the businesses that come up most.",
    },
  ],
  cards: [
    {
      icon: "grid",
      title: "A map of your rank",
      body: "Every point is colored by your position from there: top 3, 4 to 10, 11 to 20, or not found.",
    },
    {
      icon: "chart",
      title: "Rank summary",
      body: "Average rank, best rank, ranked and un-ranked points, how many points put you in the top 3, and how far the grid reaches.",
    },
    {
      icon: "users",
      title: "Who comes up instead",
      body: "The businesses found across the grid, at how many points each one appears, and their average and best rank.",
    },
    {
      icon: "target",
      title: "Any keyword, any spread",
      body: "Check one phrase across a few blocks or a whole metro area, from a 3×3 to a 15×15 grid.",
    },
    {
      icon: "history",
      title: "Scan history",
      body: "Every grid is saved, so you can open past reports and run the same keyword again later.",
    },
    {
      icon: "file",
      title: "Print or save as PDF",
      body: "Print the report or save it as a PDF to share with your team or a client.",
    },
  ],
  spotlight: {
    kicker: "The Report",
    heading: { title: "One Search, Run From ", em: "Every Point" },
    points: [
      "At each point, the grid runs your keyword through Google's Places search from that spot and records where your business appears.",
      "If your business isn't in the results returned for a point, that point shows as not found.",
      "The top five businesses at each point are kept, so you can see who outranks you where.",
      "A grid that fails gives its credits back.",
    ],
    panel: {
      label: "The report",
      title: "What every grid report holds",
      items: [
        "Rank at each point", "Average rank", "Best rank", "Ranked points", "Un-ranked points", "Top 3 count",
        "Rank distribution", "Businesses found", "Grid span",
      ],
      note: "Print it or save it as a PDF from the report.",
    },
  },
  audience: [
    {
      title: "Contractors with a wide service area",
      body: "See whether you show up in the towns you drive to, not just near your shop.",
    },
    {
      title: "Owners checking their own work",
      body: "Run the same keyword before and after you work on your profile and website, and compare the reports.",
    },
    {
      title: "Agencies reporting to clients",
      body: "A map and a PDF a client can read at a glance.",
    },
  ],
  pricing: {
    kind: "plan",
    allowance: CREDITS,
    note: "Bigger grids use more credits, and a grid that fails gives its credits back.",
  },
  faqs: [
    {
      q: "What do I need to run a grid?",
      a: "Your business on Google Maps and a keyword. You don't need to connect a Google account: search by name or paste your Maps link.",
    },
    {
      q: "Which plans include it, and how many credits does a grid use?",
      a: `Every plan includes monthly ranking-grid credits. ${allowanceLine(CREDITS)}. A grid uses one credit per 25 points, rounded up: a 5×5 grid uses ${credits(5)}, a 15×15 grid ${credits(15)}. During the trial you can run one grid.`,
    },
    {
      q: "Is it exactly what a customer sees on Google Maps?",
      a: "It's a measurement, not a screenshot. Each point uses Google's Places search for your keyword from that location, so a person searching on their own phone may see a different order. Use it to compare areas and track change over time.",
    },
    {
      q: "Will it raise my ranking?",
      a: "No. The grid measures where you appear; it doesn't change anything on Google. Use it to see where to focus, then run it again to check.",
    },
  ],
  related: ["gbp", "competitors", "siteScan"],
  app: { href: "/ranking-grid", surface: "app" },
  headings: {
    steps: { title: "From Keyword to Map in ", em: "Four\u00a0Steps" },
    cards: { title: "What Every Grid ", em: "Shows\u00a0You" },
    faq: { title: "Before You ", em: "Run a Grid" },
  },
  seo: {
    title: "GMB Ranking Grid — Local Map Rank Checker | ConstructHUB",
    description:
      "See where your business ranks for a keyword across your service area on a map grid, with average rank, best rank and the businesses that come up most.",
  },
  sources: [
    "client/src/pages/ranking-grid.tsx",
    "server/routes.ts",
    "server/growth-quotas.ts",
    "shared/plans.ts (gridCreditCost)",
  ],
};

export default page;
