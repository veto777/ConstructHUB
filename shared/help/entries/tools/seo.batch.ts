import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/batch.tsx and server/seo/batch.ts as they run. */
const entry: HelpDraft = {
  key: "seo.batch", parent: "seo", group: "Tools", route: "/seo/batch", title: "SEO Suite → Batch analysis",
  whatItIs: "The headline numbers for many websites at once, up to 100, to size up a list of competitors or sites you might get a link from.",
  whatItDoes: "Paste websites one per line (full addresses are fine; only the site name is used) and get each one’s authority, linking sites, links, estimated search visits and keywords in one table, sortable and exportable. Every row opens that site in Site explorer, and every figure opens the explorer’s report for it.",
  howToUse: [
    "Paste the list: the competitors from your rank tracker, the sites from a Content explorer search, or any list you have.",
    "Press Analyse: the price for that many sites shows first, and a list you looked up in the last " + SAVED + " opens free.",
    "Sort the table by the column you care about, open a site in Site explorer, or export the table.",
  ],
  howItWorks: "One lookup priced by the number of sites, saved under the exact list and reopened free for " + SAVED + ". A column that failed to load is named on the page with a button to ask for it again; the other columns are complete. Only the first 100 sites of a longer list are looked up.",
};
export default entry;
