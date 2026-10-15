import type { HelpDraft } from "../../types";

/** Written from client/src/pages/competitors.tsx and server/routes.ts (GET /api/competitors/scans/:id) as they run. */
const entry: HelpDraft = {
  key: "competitor-intel.market-report", parent: "competitor-intel", group: "Tools", route: "/competitors", title: "Competitor Intel → Market report",
  whatItIs: "What an opened scan shows: the market in numbers, its leaders, how ratings and review counts spread, and every listing.",
  whatItDoes: "The strip at the top counts the competitors, their average rating, the reviews in the market with the most-reviewed business named, and how many listings fall in each review-signal band. The overview names the top-rated businesses, with three leader tiles under it. Two bars show how many listings sit at 5.0, 4.5 to 4.9, 4.0 to 4.4, below 4.0 or unrated, and how many have 100 or more reviews, 25 to 99, 1 to 24 or none. The full list then shows each business best-rated first, with its rating, review count, category, address, Call, Directions and Website buttons, and its review signals in one line.",
  howToUse: [
    "Choose Open report on a scan card (or its title) to open it; Close report folds it back to its four key numbers.",
    "Read the strip and the leaders first: they say who is winning on rating and on review count.",
    "Use the two bars to see where your own rating and review count would sit in this market.",
    "Scroll the list; More businesses shows the next eight. Review analysis on a business opens the breakdown of its sampled reviews.",
    "Re-run starts the same scan again as a new scan; Delete removes the scan and its listings for good, after a confirmation.",
  ],
  howItWorks: "The scan’s listings come from the server already ordered best-rated first and most-reviewed among equals (an unrated listing goes last); the page never re-sorts them. The numbers in the strip and the bars are added up from those listings in the browser. A leader is a rated listing whose review signals stay below the “More signals” band — a 5.0 with a suspicious review sample is not named a leader, and the overview’s footnote says so when that happened. Ratings and counts are as Google showed them on the day of the scan; the date is under the overview.",
  needs: ["A completed scan. A scan that is still running shows partial results until it finishes."],
};
export default entry;
