import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/keywords.tsx, keyword-lists.tsx, planner.tsx and server/seo/routes.ts, reports.ts, planner.ts as they run. */
const entry: HelpDraft = {
  key: "seo.keywords", parent: "seo", group: "Tools", route: "/seo/keywords", title: "SEO Suite → Keywords explorer",
  whatItIs: "Research for one search term, many at once, your services by town, and your saved lists. It shows how often people search, how hard it is to rank, what a click costs and who ranks today.",
  whatItDoes: "For one keyword, Google’s own numbers (when on for your account) give monthly searches, cost per click, bids and four years of history, free. The full lookup, at the price on the page, adds how hard it is to rank, who holds the top ten, traffic potential and what Google’s results page showed. Keyword ideas lists related terms and questions; Many keywords takes a pasted list; Service × town puts your services against your towns, with searches and where you rank. My lists keeps keywords in named lists, free, and any keyword can be tracked on one of your sites.",
  howToUse: [
    "Type a keyword, pick the country (and a US state, county, city or ZIP code for local numbers) and press Look up.",
    "Read the overview: searches by month, difficulty, cost per click, intent and who ranks.",
    "Open Keyword ideas for the searches around it, narrow them with the filters, and tick the ones worth tracking.",
    "Switch tabs for Many keywords (a pasted list), Service × town (your services by town) or My lists (what you saved).",
    "Choose Track on a keyword or a selection to add it to the chosen site’s rank tracker; it is checked on the site’s next check.",
  ],
  howItWorks: "A saved overview reopens free for " + SAVED + ". When Google’s numbers are on for your account, keyword ideas are free too; otherwise each page of ideas is its own lookup, priced first. Google’s free numbers come from Google’s keyword planner when it is connected for your account; difficulty and who ranks come from the keyword database. A keyword sent to the tracker from another country goes in without its numbers, because they are that country’s. Only the countries listed are available.",
};
export default entry;
