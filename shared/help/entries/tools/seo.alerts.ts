import type { HelpDraft } from "../../types";
import { SEO_SAVED_DAYS, savedForWords } from "../../../seo-constants";

/** The saved-copy window in words ("a week"): one constant for every SEO page (shared/seo-constants.ts). */
const SAVED = savedForWords(SEO_SAVED_DAYS);

/** Written from client/src/pages/seo/alerts.tsx, keyword-watch.tsx and server/seo/alerts.ts as they run. */
const entry: HelpDraft = {
  key: "seo.alerts", parent: "seo", group: "Tools", route: "/seo/alerts", title: "SEO Suite → Alerts",
  whatItIs: "What changed since the last check: rankings that fell or rose, the Google map pack entered or left, linking sites lost or gained, local grid moves, searches newly seen or gone, and new mentions.",
  whatItDoes: "Lists each alert with the keywords, links or scan it is about — every one a link to that thing on its own page — and marks what is unread. The same alerts reach the bell, and your inbox when email alerts are on in Settings. Under the list, the keyword watch compares two snapshots of a site's keywords.",
  howToUse: [
    "Choose All alerts or one kind (Rankings fell, Links lost, …) and this site or all sites.",
    "Open an alert's keyword, site or scan to see it on the rank tracker, Backlinks, the local grid or Mentions.",
    "Mark all read when you are done; Show more loads older alerts.",
    "Turn a site's alerts and their threshold on or off in the rank tracker's Tracking settings, and email delivery under Settings → Notifications.",
  ],
  howItWorks: "An alert is written when a check, a backlink snapshot, a grid repeat or a mentions watch finishes and finds a change at or beyond the site's threshold; opening this page costs nothing. An alert whose bell or email delivery was given up after repeated tries stays here, marked. The kind and site in view are in the address, so a link lands on the same list.",
};
export default entry;
