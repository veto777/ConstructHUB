import type { HelpDraft } from "../../types";

/** Written from client/src/pages/seo/backlinks.tsx and server/seo/routes.ts, jobs.ts as they run. */
const entry: HelpDraft = {
  key: "seo.backlinks", parent: "seo", group: "Tools", route: "/seo/backlinks", title: "SEO Suite → Backlinks",
  whatItIs: "Who links to one of your sites: a saved copy every month, refreshable once a day, with the links lost since the copy before and the strongest linking pages.",
  whatItDoes: "A row of figures (authority, backlinks, linking sites, linking pages and spam score, each against the copy before), then two lists. One is the links lost since the copy before. The other is the strongest linking pages, which you can narrow to the ones new in this copy. Every figure and row opens the Site explorer view that holds it. You can narrow the page to links from one site, and send a lost link to the Action plan to win it back.",
  howToUse: [
    "Pick the site and press Refresh now for the first copy; the price is on the button, and it pulls the summary and the top 100 linking pages.",
    "Read the lost links after each monthly copy: those are the sites to ask again.",
    "Use the strongest linking pages to see what earned them, and narrow to one linking site with its link.",
    "Press Plan on a lost link worth winning back to add it to the Action plan.",
  ],
  howItWorks: "After the first refresh a new copy is taken every month on its own, from your included SEO data, and each one lists the links gone since the one before. Opening the page shows the copy on file and spends nothing; Refresh now is the only purchase, and a second refresh on the same day returns that day's copy. The section and the linking site in view are in the address, so an alert about a lost link lands on it.",
};
export default entry;
