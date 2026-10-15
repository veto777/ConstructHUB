import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/grid.tsx and server/seo/grid.ts, grid-monitor.ts as they run. */
const entry: HelpDraft = {
  key: "seo.local-grid", parent: "seo", group: "Tools", route: "/seo/local-grid", title: "SEO Suite → Local grid",
  whatItIs: "Where your business shows up in Google’s local results across your service area: a square of points, each searched as if standing there.",
  whatItDoes: "Find your Google Business listing once (a Google Maps search, priced on the button), then scan a search over a 3 × 3, 5 × 5 or 7 × 7 grid of points 1, 2, 3, 5 or 10 miles apart. Each point shows your place in Google’s local finder for that search made from that spot, with the businesses found there. Scans are kept so each can be compared with the one before, and a scan can be set to repeat every week or month.",
  howToUse: [
    "Pick the site, then search your business by name and town and choose the right listing on the map.",
    "Type a search your customers make (“siding contractor”), choose how many points and how far apart, and press Scan; the price is on the button, and the most it can cost is set aside while it runs.",
    "Read the grid: green points are where you are one of the first three, and a point opens the businesses Google showed there.",
    "Choose a repeat, weekly or monthly, to watch the area over time; repeats are taken from your included SEO data.",
    "Open earlier scans from the history to compare.",
  ],
  howItWorks: "Each point is one lookup of Google’s local results made for that spot; the scan’s price is the number of points times the price per point, shown before it runs, and what is set aside but not used comes straight back. The grid is centered on the Google listing you chose and that listing is what is looked for at every point. The scan on screen and the point picked are in the address, so a link from an alert or a report lands on the same view, and arriving by link never runs a scan.",
};
export default entry;
