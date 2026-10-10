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
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): the grid centered on the business's Maps
  // coordinates, the odd sizes 3–15, spacing 0.5–20 miles and the point layout are client/src/pages/ranking-grid.tsx
  // (selectedBusiness lat/lon, GRID_SIZES, DISTANCE_OPTIONS) + server/routes.ts POST /api/ranking-grid/scans and
  // runRankingGridScan (Places text search with a location bias at each point, the business's position among the
  // results returned, the top five kept per point); the colour bands and summary are ranking-grid.tsx; the credit cost
  // and refund are shared/plans.ts gridCreditCost + server/routes.ts refundReservation.
  inDepth: {
    heading: { title: "A Local Rank Tracker for Google Maps, ", em: "Explained" },
    paragraphs: [
      "When someone searches for the work you do, Google shows a short list of local businesses with a map, and the " +
        "order depends partly on where the person searching is. A contractor who comes up first near the shop can be " +
        "missing a few towns over. The GMB Ranking Grid is a local rank tracker that measures that spread for one " +
        "search phrase at a time, so you can see your Google Maps ranking across your service area instead of from " +
        "one spot.",
      "The grid is centered on your business's location on Google Maps. You choose its size, from 3 by 3 to 15 by 15 " +
        "points, and the spacing between neighboring points, from half a mile to 20 miles. A 5 by 5 grid with points " +
        "2 miles apart, for example, covers 8 miles from edge to edge. At each point the grid runs your keyword " +
        "through Google's Places search from that spot and records where your business appears among the results " +
        "returned. If it isn't among them, the point shows as not found.",
      "Read the report as a map of where you are strong and where you are missing. Pins in the top 3 close to your " +
        "address that fade to not found further out show where your reach ends for that phrase. Because the top five " +
        "businesses at every point are kept, the report also shows which competitors come up where you don't, and " +
        "their average and best rank across the grid. Running the same keyword again later, from your scan history, " +
        "shows whether that picture changed.",
      "Bigger grids run more searches, so they use more credits: one credit per 25 points, rounded up. A grid that " +
        "fails gives its credits back. You don't connect a Google account; the grid only needs your business on " +
        "Google Maps and a keyword. The result is a measurement taken through Google's Places search at one moment, " +
        "not a copy of what any one person sees on their phone, so use it to compare areas and track change over " +
        "time. The grid itself changes nothing on Google.",
    ],
  },
  // Prices read on 2026-10-10 from: localfalcon.com/pricing, whitespark.ca/pricing/, brightlocal.com/pricing/,
  // gmbbriefcase.com/pricing (~/codex-audits/a-la-carte-competitors.md → gridrank).
  compare: {
    alacarte: ["gridrank"],
    checkedOn: "2026-10-10",
    competitors: [
      { name: "Local Falcon", plan: "Starter", price: { kind: "monthly", cents: 2499 }, note: "credits; a 7×7 grid is 49 credits", source: "https://www.localfalcon.com/pricing" },
      { name: "Whitespark", plan: "Local Ranking Grids", price: { kind: "monthly_from", cents: 1000 }, source: "https://whitespark.ca/pricing/" },
      { name: "BrightLocal", plan: "Track", price: { kind: "monthly", cents: 4100 }, note: "a 5-keyword grid", source: "https://www.brightlocal.com/pricing/" },
      { name: "GMB Briefcase", plan: "Business", price: { kind: "monthly", cents: 9900 }, source: "https://gmbbriefcase.com/pricing" },
    ],
    onlyUs: [
      "Find your business by name or paste your Google Maps link — no Google account connection needed.",
      "One credit per 25 grid points, and a failed grid refunds its credits.",
      "Who comes up instead of you at every point on the map.",
      "Print any grid or save it as a PDF.",
    ],
    theyNotUs: "Bigger grids (up to 21×21) and AI write-ups of the results.",
    noContractorAlternative: true,
  },
  related: ["gbp", "competitors", "siteScan"],
  app: { href: "/ranking-grid", surface: "app" },
  headings: {
    steps: { title: "From Keyword to Map in ", em: "Four\u00a0Steps" },
    cards: { title: "What Every Grid ", em: "Shows\u00a0You" },
    faq: { title: "Before You ", em: "Run a Grid" },
  },
  seo: {
    title: "Google Maps Rank Checker: GMB Ranking Grid | ConstructHUB",
    description:
      "Check where your business ranks on Google Maps for a keyword across your service area, point by point on a grid, and see who outranks you where.",
  },
  sources: [
    "client/src/pages/ranking-grid.tsx",
    "server/routes.ts",
    "server/growth-quotas.ts",
    "shared/plans.ts (gridCreditCost)",
  ],
};

export default page;
