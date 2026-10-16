import type { HelpDraft } from "../../types";

/** Written from client/src/pages/competitors.tsx and server/routes.ts (GET /api/competitors/scans/:id) as they run. */
const entry: HelpDraft = {
  key: "competitor-intel.market-report", parent: "competitor-intel", group: "Tools", route: "/competitors", title: "Competitor Intel → Market report",
  whatItIs: "What an opened scan shows: the market in numbers, its leaders, how ratings and review counts spread, and every listing.",
  whatItDoes: "The strip at the top counts the competitors, their average rating, the reviews in the market (naming the most-reviewed business) and how many listings fall in each review-signal band. The overview names up to three top-rated businesses, with a leader tile for each. It is left out when no rated listing stays below the More signals band. Two bars show how many listings sit at 5.0, 4.5 to 4.9, 4.0 to 4.4, below 4.0 or unrated, and how many have 100 or more reviews, 25 to 99, 1 to 24 or none. The full list shows each business best-rated first, with its rating, reviews, category, address, Call, Directions and Website buttons, and its review signals in one line.",
  howToUse: [
    "Choose Open report on a scan card (or its title) to open it; Close report folds it back to its four key numbers.",
    "Read the strip and the leaders first: they say who is winning on rating and on review count.",
    "Use the two bars to see where your own rating and review count would sit in this market.",
    "Scroll the list; More businesses shows the next eight, and Review analysis on a business opens the breakdown of its sampled reviews.",
    "Use Re-run to start the same scan again as a new scan, or Delete to remove the scan and its listings for good, after a confirmation.",
  ],
  howItWorks: "Listings come already ordered best-rated first, and most-reviewed first among equals, with unrated ones last; the page never re-sorts them, and the strip and bars are added up from them. A leader is a rated listing whose reviews stay below the “More signals” band. A 5.0 with suspicious-looking reviews is not named a leader, and a footnote says so when that happens. Ratings and counts are as Google showed them on the day of the scan, dated under the overview.",
  needs: ["A completed scan. A scan that is still running shows partial results until it finishes."],
};
export default entry;
