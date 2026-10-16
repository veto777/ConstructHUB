import type { HelpDraft } from "../../types";

/** Written from client/src/pages/seo/grid.tsx and server/seo/grid.ts, grid-monitor.ts as they run. */
const entry: HelpDraft = {
  key: "seo.local-grid", parent: "seo", group: "Tools", route: "/seo/local-grid", title: "SEO Suite → Local grid",
  whatItIs: "Where your business shows up in Google’s local results across your service area: a square of points, each searched as if standing there.",
  whatItDoes: "Find your Google Business Profile once (a Google Maps search, priced on the button). Then scan a search over a 3 × 3, 5 × 5 or 7 × 7 grid of points 1, 2, 3, 5 or 10 miles apart. Each point shows your place in Google’s local finder for that search made from that spot, with the first three businesses there. Scans are kept so each can be compared with the one before, and a scan can be set to repeat every week or month.",
  howToUse: [
    "Pick the site, then search your business by name and town and choose the right listing on the map.",
    "Type a search your customers make (“siding contractor”), choose the grid, and press Scan; the price is on the button.",
    "Read the grid: green points are where you are one of the first three, and selecting a point shows the first three businesses Google listed there.",
    "Choose a repeat, weekly or monthly, to watch the area over time; repeats are taken from your included SEO data.",
    "Open earlier scans from the history to compare.",
  ],
  howItWorks: "Each point is one lookup of Google’s local results from that spot. The price is the number of points times the price per point, shown before it runs, and anything set aside but not used comes straight back. The grid is centered on the Google listing you chose and that listing is what is looked for at every point. A link from an alert or a report opens the same scan and point, and opening a link never runs a scan.",
};
export default entry;
