import type { HelpDraft } from "../../types";

/** Written from client/src/pages/seo/alerts.tsx, keyword-watch.tsx and server/seo/alerts.ts as they run. */
const entry: HelpDraft = {
  key: "seo.alerts", parent: "seo", group: "Tools", route: "/seo/alerts", title: "SEO Suite → Alerts",
  whatItIs: "What changed since the last check: rankings up or down, the Google map pack entered or left, and linking sites lost or gained. It also covers local grid moves, searches newly seen or gone, and new mentions.",
  whatItDoes: "It lists each alert with the keywords, links or scan it is about, every one a link to that thing on its own page, and marks what is unread. The same alerts reach the bell, and your inbox when email alerts are on in Settings. Under the list, the keyword watch compares two saved copies of a site’s keywords.",
  howToUse: [
    "Choose All or one kind (Rankings fell, Links lost, …), and all your sites or this site only.",
    "Open an alert’s keyword, site or scan to see it on the rank tracker, Backlinks, the local grid or Mentions. Searches newly seen or gone open in Site explorer and the keyword watch below.",
    "Mark all read when you are done; Show more loads older alerts.",
    "Turn a site’s alerts on or off, and set how many positions a ranking must move, in the rank tracker’s Tracking settings. Turn on email delivery under Settings → Notifications.",
  ],
  howItWorks: "An alert is written when a rank check, a backlink copy, a grid repeat, a keyword watch copy or a mentions watch finds a big enough change. For rankings, that means a move at or past the site’s cutoff. Opening this page costs nothing. An alert whose bell or email could not be delivered after repeated tries stays here, marked. A link to this page opens the same kind and site.",
};
export default entry;
