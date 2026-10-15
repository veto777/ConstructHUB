import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/backlinks.tsx and server/seo/routes.ts, jobs.ts as they run. */
const entry: HelpDraft = {
  key: "seo.backlinks", parent: "seo", group: "Tools", route: "/seo/backlinks", title: "SEO Suite → Backlinks",
  whatItIs: "Who links to one of your sites: a snapshot every month, refreshable any time, with the links lost since the snapshot before and the strongest linking pages.",
  whatItDoes: "A row of figures — authority, backlinks, referring domains, spam score and more, each against the snapshot before — then the lists: Lost links, New links, Strongest links and All links. Every figure and row opens the Site explorer view that holds it, the page narrows to the links from one site, and a lost link can be sent to the Action plan to win back.",
  howToUse: [
    "Pick the site and press Refresh now for the first snapshot — the price is on the button; it pulls the summary and the top 100 linking pages.",
    "After each monthly snapshot read Lost links: those are the sites to ask again.",
    "Use Strongest links to see what earned them, and narrow to one linking site with its link.",
    "Choose Add to plan on a link worth winning back.",
  ],
  howItWorks: "After the first refresh a new snapshot is taken every month on its own, from your included SEO data, and each one lists the links gone since the one before. Opening the page shows the snapshot on file and spends nothing; Refresh now is the only purchase. The section and the linking site in view are in the address, so an alert about a lost link lands on it.",
};
export default entry;
