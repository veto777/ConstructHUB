import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/keywords.tsx, keyword-lists.tsx, planner.tsx and server/seo/routes.ts, reports.ts, planner.ts as they run. */
const entry: HelpDraft = {
  key: "seo.keywords", parent: "seo", group: "Tools", route: "/seo/keywords", title: "SEO Suite → Keywords explorer",
  whatItIs: "Research for one search term, many at once, your services by town, and your saved lists. It shows how often people search, how hard it is to rank, what a click costs and who ranks today.",
  whatItDoes: "One keyword: when Google’s own numbers are on for your account, search volume, cost per click, bids and four years of monthly volume answer free; the full lookup (difficulty, who held the top ten and how strong they are, traffic potential, what the results page showed) is bought at the price on the page. Under the overview, Keyword ideas lists the matching terms, related terms and questions around it, filterable, sortable, paged and exportable. Many keywords takes a pasted list and returns the numbers for all of them, and Service × town puts your services against the towns you serve, each cell a search with its volume and where your site ranks. My lists keeps keywords in named lists, free to open and edit, and any keyword can be tracked on one of your sites.",
  howToUse: [
    "Type a keyword, pick the country (and a US state, county, city or ZIP code for local numbers) and press Look up.",
    "Read the overview: volume by month, difficulty, cost per click, intent and who ranks; when only Google’s free numbers are shown, choose the full lookup for difficulty and who ranks, priced on the button.",
    "Open Keyword ideas for the searches around it, narrow them with the filters, and tick the ones worth tracking.",
    "Switch tabs for Many keywords (a pasted list), Service × town (your services by town) or My lists (what you saved).",
    "Choose Track on a keyword or a selection to add it to the chosen site’s rank tracker; it is checked on the site’s next check.",
  ],
  howItWorks: "A saved overview reopens free for " + SAVED + "; each page of ideas is its own lookup, priced first. Google’s free numbers come from Google’s keyword planner when it is connected for your account; difficulty and who ranks come from the keyword database. A keyword sent to the tracker from another country goes in without its numbers, because they are that country’s. Only the countries listed are available.",
};
export default entry;
