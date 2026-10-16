import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/index.tsx, rank-history.tsx, rank-tags.tsx, rank-competitors.tsx, serp-groups.tsx, competing.tsx, gsc-breakdown.tsx and server/seo/routes.ts, jobs.ts as they run. */
const entry: HelpDraft = {
  key: "seo.rank-tracker", parent: "seo", group: "Tools", route: "/seo/rank-tracker", title: "SEO Suite → Rank tracker",
  whatItIs: "Where your site was found in Google’s results for the keywords you chose, checked on a schedule and kept as history.",
  whatItDoes: "The figures row shows visibility, average position, keywords in the top 10 and top 3, movement, the Google map pack (the map with three businesses), Search Console clicks when connected, the next check and your keyword allowance. The panels below show history by day, tags, competitors on your keywords, Google results groups, the Search Console breakdown and competing pages. The table lists each keyword’s position on desktop and mobile with its movement, map-pack place, searches, ranking page and check date. A row opens its history and the saved first page of Google.",
  howToUse: [
    "Pick the site in the bar, choose Add keywords and type them one per line (up to 500, with an optional tag and city or ZIP).",
    "Wait for the automatic check (weekly unless you change it), or press Run check now at the price on the button.",
    "Open Tracking settings: type your business name exactly as on Google, switch alerts on, and pick weekly, twice-weekly or daily checks (monthly cost shown).",
    "Choose Get search volumes (priced on the button) when some keywords have none; it also refreshes volumes more than 30 days old.",
    "Use the figures, or the tag, place, movement and feature links in the table, to narrow it; a chip says what narrows it, with a way to clear.",
  ],
  howItWorks: "A check reads Google’s results for each keyword on each device, as deep as the site’s setting (top 10 to top 100), from the site’s country or the place chosen for the keyword. Automatic checks use only your plan’s SEO data, never credit you bought. When it runs out, that check is skipped and the next one comes at its usual time. Run check now uses your included data, then your bought credit, at the price shown. It is not held back by the once-a-day rule, but it is refused if your balance can’t cover it. A site is checked automatically at most once a day, and never with no keywords. “New” and “lost” mean found or not found in the results read, not that a ranking appeared or is gone.",
};
export default entry;
