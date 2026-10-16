import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/explorer.tsx, lookup-box.tsx and server/seo/explorer.ts, routes.ts as they run. */
const entry: HelpDraft = {
  key: "seo.explorer", parent: "seo", group: "Tools", route: "/seo/explorer", title: "SEO Suite → Site explorer",
  whatItIs: "A report on any website, yours or a competitor’s: how much search traffic it gets, from which keywords and pages, who links to it and who it competes with.",
  whatItDoes: "Type a site and press Analyse: one report (priced on the page) gives its authority, backlinks (links from other sites) and linking sites with a year of history. It adds free-search (organic) and paid keyword counts and estimated traffic with two years of history, rankings by position, and the first top pages, competitors, linking sites and link texts. Each list opens in full from the left menu. Each page of a full list, and the Ads list, is a lookup of its own, priced on its Run report button. Opportunities, Content gap, Link intersect, Directories and Mentions are separate lookups, each priced first, and Compare two months reads the saved history free. Add to my sites puts the site on your dashboard and in the rank tracker, free, and nothing is checked or charged until you add keywords.",
  howToUse: [
    "Type the site name in the box at the top, pick the country, and press Analyse; a report bought less than " + SAVED + " ago opens free, otherwise the price shows first.",
    "Read the headline figures; each figure, its change and each month on a chart is a link to the rows behind it.",
    "Open a list from the left menu, such as Backlinks, Organic keywords or Top pages.",
    "Choose Add to my sites to keep the site: it appears on the SEO dashboard and in the rank tracker at once, for free.",
    "Choose Refresh for a fresh report of a site already looked up (charged again); Recently analysed lists the reports you can still reopen free.",
  ],
  howItWorks: "A report is one lookup in a keyword and link database, saved for that site and country. For " + SAVED + " pressing Analyse reopens it free; after that Analyse buys a new one, though the older copy can still be viewed. Traffic figures are estimates from rankings and search volumes, not visits measured on the site. A section that fails to load is named, Refresh tries again, and only the listed countries can be read. Lookups come out of your plan’s monthly SEO data, then credit you bought, and a button is off when the balance would not cover it.",
};
export default entry;
