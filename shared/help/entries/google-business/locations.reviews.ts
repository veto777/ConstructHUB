import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (ReviewsTab) and server/gbp (reviews sync) as they run. */
const entry: HelpDraft = {
  key: "locations.reviews", parent: "locations", group: "Google Business", route: "/locations", title: "Locations → Reviews",
  whatItIs: "The Reviews tab of a linked location: every review on the Google listing, saved here on each sync, with a log of what changed.",
  whatItDoes: "Three counters switch the list: On Google now (every live review, with its stars, date and whether you replied), Removed (reviews Google stopped returning, with their full text kept) and Changes logged (new, edited, removed or restored reviews, newest first). Any review can be copied as text; a live review can be reported to Google from its row; a removed one has “Copy for Google”, which assembles the business name, listing link, reviewer, date, stars, text and the review counts for Google’s Business Profile support form, and a link that opens that form. “Reply to reviews” opens the Google Reviews tool for this location.",
  howToUse: [
    "Locations → open a linked location → Reviews.",
    "Read Changes logged first: it is what happened since the last sync, with a name attached.",
    "Click On Google now to browse every live review, or Removed to see the text of any that disappeared; from there, “Copy for Google” and “Report a missing review to Google” let you ask Google about it, signed in as the listing’s manager.",
    "Use “Copy the text” to keep a record, or “Reply to reviews” to answer from Google Reviews.",
  ],
  howItWorks: "The reviews are fetched from Google on every sync of the linked location and compared with the saved copy: a review missing from Google is marked removed and kept with its text, an edited one keeps its previous rating and text, and each difference is written to the change log and sent to you as an alert. The first sync only saves the reviews; it is not logged as news. The tab refreshes itself every minute while open.",
  needs: ["Any plan.", "A location linked to its Google Business Profile."],
};
export default entry;
