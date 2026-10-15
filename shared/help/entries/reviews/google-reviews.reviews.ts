import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-reviews.tsx (GoogleProfileReviewsTab), client/src/components/ai-review-replies.tsx and gbp-connection.tsx as they run. */
const entry: HelpDraft = {
  key: "google-reviews.reviews", parent: "google-reviews", group: "Reviews", route: "/google-reviews", title: "Google Reviews → Google reviews",
  whatItIs: "The reviews already on your Google Business Profile listings, pulled into ConstructHUB so you can read, reply and keep notes in one place.",
  whatItDoes: "It lists each review with the reviewer, stars, date and text, your published reply if there is one, and a private note of your own. Reply publishes to Google, a draft stays in ConstructHUB, and a published reply can be deleted from Google. The tiles count the reviews matching the filters, the unanswered ones and the average rating. The AI review replies card drafts replies for one location (Off, Draft for approval or Auto-publish) and lists the drafts waiting for you.",
  howToUse: [
    "Connect Google and link a location in the card at the top, then choose Sync now.",
    "Filter by location, stars and Answered / Unanswered, or search the text.",
    "Choose Reply on a review, write it, then Publish to Google or Save draft.",
    "Choose Note to add a private note for your team.",
    "Pick the location, a mode and a scope in AI review replies, then approve or edit each draft in the queue.",
  ],
  howItWorks: "Reviews are pulled from Google for each linked location and stored with that location; a review typed in by hand is marked as not from Google. Publishing a reply sends it to Google through the same connection and shows Google's answer. Only a review that came from Google can be replied to there. AI drafts are written from the review text and your settings, stay drafts until you publish them, and can get facts wrong, so read every one.",
  needs: ["A connected Google account and a linked location (Google Business → Locations)."],
};
export default entry;
