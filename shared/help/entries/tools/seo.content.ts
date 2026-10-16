import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/content.tsx and server/seo/content.ts as they run. */
const entry: HelpDraft = {
  key: "seo.content", parent: "seo", group: "Tools", route: "/seo/content", title: "SEO Suite → Content explorer",
  whatItIs: "A search of the web for pages written about a topic: who writes about what you sell, how strong their site is and when they published.",
  whatItDoes: "Each page of 25 results shows the article’s title, site, authority, date and author. Filters set sort order, publish date, lowest site authority and kind of site (blogs, news, company sites, forums, shops), and a switch leaves your own site out. For the articles on screen you can add how many sites link to each and its search visits, at the price shown. Each figure opens that page or site in Site explorer, and the results export to CSV.",
  howToUse: [
    "Type a topic your customers care about (“roof replacement cost”) and press Search; a search from less than " + SAVED + " ago reopens free, otherwise the price shows first.",
    "Narrow with the filters, such as Published (up to two years back) and Site authority at least (1 to 100).",
    "Choose “Add linking sites and search visits” to see which of these sites are worth asking for a link.",
    "Open a result’s figures in Site explorer, or export the page.",
  ],
  howItWorks: "Each new page of results is one lookup, and moving to a page you have not opened is another, priced first. A search is saved under its words and filters and reopens free for " + SAVED + "; results that could not be kept are said so and are not free to reopen. The filters are in the address, so a link lands on the same search.",
};
export default entry;
