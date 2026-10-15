import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/index.tsx, rank-history.tsx, rank-tags.tsx, rank-competitors.tsx, serp-groups.tsx, competing.tsx, gsc-breakdown.tsx and server/seo/routes.ts, jobs.ts as they run. */
const entry: HelpDraft = {
  key: "seo.rank-tracker", parent: "seo", group: "Tools", route: "/seo/rank-tracker", title: "SEO Suite → Rank tracker",
  whatItIs: "Where your site was found in Google’s results for the keywords you chose, checked on a schedule and kept as history.",
  whatItDoes: "The figures row shows visibility, average position, keywords in the top 10 and top 3, movement since the last check, the Google map pack, tracked keywords, Search Console clicks when that website is connected, the next automatic check and your plan’s keyword allowance. The panels below show history by day, tags, competitors on your keywords, Google results groups, the Search Console breakdown and competing pages. The table lists each keyword’s position on desktop and mobile with its movement, map-pack place, what the results page showed, volume, the ranking page and the check date; a row opens its history and the saved first page of Google.",
  howToUse: [
    "Pick the site in the bar (or add one), then choose Add keywords: one per line, up to 500 at a time, with an optional tag and an optional city or ZIP code to check from.",
    "Wait for the automatic check (weekly unless you change it) or press Run check now; the price of a check is on the button and the results arrive over a few minutes.",
    "Open Tracking settings: add your business name exactly as on Google so you are found in the map pack, switch alerts on and set how many positions count as a move (a listed value or any number from 1 to 20), and set checks to weekly, twice a week or daily; the monthly cost of each is shown.",
    "Choose Get search volumes for keywords without one (priced on the button).",
    "Use the figures and the tabs to narrow the table; a chip says what narrows it, with a way to clear.",
  ],
  howItWorks: "A check reads Google’s result pages for each keyword on each device the site tracks, as deep as the site’s setting (top 10 to top 100 results), from the site’s country or the place chosen for the keyword. Automatic checks use only the SEO data your plan includes; when that runs out they wait, and they are never charged to credit you bought, while Run check now always runs, at the price shown. A site already checked on a day is not checked again automatically that day, and a site with no keywords is never checked. Movement compares the newest check with the one before; “new” and “lost” mean found or not found in the results read, not that a ranking exists or is gone.",
};
export default entry;
