import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/explorer.tsx, lookup-box.tsx and server/seo/explorer.ts, routes.ts as they run. */
const entry: HelpDraft = {
  key: "seo.explorer", parent: "seo", group: "Tools", route: "/seo/explorer", title: "SEO Suite → Site explorer",
  whatItIs: "A report on any website, yours or a competitor’s: how much search traffic it gets, from which keywords and pages, who links to it and who it competes with.",
  whatItDoes: "Type a site and press Analyse. One report (its price is on the page) returns the site’s authority, backlinks and referring domains with a year of link history, its organic keywords and estimated traffic with two years of monthly history, keywords by position band, movement since last month, top pages, organic competitors, paid keywords and ads; the left menu opens each list in full, with filters, sorting, paging and export. Opportunities, Content gap, Link intersect, Directories and Mentions are lookups of their own, each with its own price shown first, and Compare two months reads the saved history free. Add to my sites puts the site on your dashboard and in the rank tracker, free, and nothing is checked or charged until you add keywords.",
  howToUse: [
    "Type the site name in the box at the top (a full address is fine; it is read as the site), pick the country, and press Analyse; a report bought in the last " + SAVED + " opens free, otherwise the price is shown and nothing is bought until you press.",
    "Read the headline figures; each figure, its change and each month on a chart is a link to the rows behind it.",
    "Open a report from the left menu (Backlinks, Referring domains, Organic keywords, Top pages, Organic competitors and the rest); keywords can be added to a list or sent to the rank tracker of one of your sites.",
    "Choose Add to my sites to keep the site: it appears on the SEO dashboard and in the rank tracker at once, for free.",
    "Choose Refresh for a fresh report of a site already looked up (charged again); Recently analysed lists the reports you can still reopen free.",
  ],
  howItWorks: "A report is one lookup against a keyword and link database, saved under the site and the country and reopened free for " + SAVED + "; after that a new one is bought. Traffic figures are estimates made from rankings and search volumes, not visits measured on the site. A section that fails to load is named on the page, and Refresh tries again; the country picker chooses which country’s search results are read, and only the countries listed are available. Lookups come out of the SEO data your plan includes each month, then out of credit you bought; a button is off when the balance would not cover it.",
};
export default entry;
