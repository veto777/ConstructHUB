import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (ReviewsTab) and server/gbp (reviews sync) as they run. */
const entry: HelpDraft = {
  key: "locations.reviews", parent: "locations", group: "Google Business", route: "/locations", title: "Locations → Reviews",
  whatItIs: "The Reviews tab of a linked location: every review on the Google listing, saved here on each sync, with a log of what changed.",
  whatItDoes: "Three counters switch the list: On Google now (every live review), Removed (reviews Google stopped returning, with their full text kept) and Changes logged (new, edited, removed or restored reviews, newest first). Any review can be copied as text, and a live one can be reported to Google from its row. For a removed review, “Copy for Google” assembles everything Google's support form asks for and links to that form. “Reply to reviews” opens the Google Reviews tool for this location.",
  howToUse: [
    "Open a linked location under Locations and choose Reviews.",
    "Read Changes logged first: what happened since the last sync, with a name attached.",
    "Click On Google now to browse every live review, or Removed for the text of any that disappeared.",
    "Choose “Copy for Google” or “Report a missing review to Google” to ask Google about one, signed in as the listing's manager.",
    "Choose “Reply to reviews” to answer from Google Reviews.",
  ],
  howItWorks: "The reviews are pulled from Google on every sync and compared with the saved copy. A review missing from Google is marked removed and kept with its text, an edited one keeps its previous rating and text, and each difference is logged and sent to you as an alert. The first sync only saves the reviews and is not logged as news. The tab refreshes itself every minute while open.",
  needs: ["Any plan.", "A location linked to its Google Business Profile."],
};
export default entry;
