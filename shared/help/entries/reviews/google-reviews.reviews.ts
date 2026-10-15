import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-reviews.tsx (GoogleProfileReviewsTab), client/src/components/ai-review-replies.tsx and gbp-connection.tsx as they run. */
const entry: HelpDraft = {
  key: "google-reviews.reviews", parent: "google-reviews", group: "Reviews", route: "/google-reviews", title: "Google Reviews → Google reviews",
  whatItIs: "The reviews already on your Google Business Profiles, synced into ConstructHUB so you can read, reply and keep notes in one place.",
  whatItDoes: "It lists each synced review with the reviewer, stars, date and text, your published reply when there is one, and a private note of your own. Reply publishes to Google, a draft stays in ConstructHUB, and a published reply can be deleted from Google. The tiles count the reviews matching the filters, the unanswered ones and the average rating; the rating breakdown shows the share of each star. The AI review replies card drafts replies for one location — Off, Draft for approval or Auto-publish — and lists the drafts waiting for you.",
  howToUse: [
    "Connect Google and link a location in the card at the top, then choose Sync now so the reviews arrive.",
    "Filter by location, star rating and Answered / Unanswered, or search the text; Clear filters resets them.",
    "Choose Reply on a review, write it, then Publish to Google or Save draft. Add a private note for your team with Note.",
    "For AI drafts, pick the location in AI review replies, choose a mode and a scope, and approve or edit each draft in the queue.",
  ],
  howItWorks: "Reviews are read from the Google Business Profile API for each linked location and stored with the location they belong to; a review entered by hand is marked as not synced. Publishing a reply sends it to Google through the same connection and shows Google’s answer. Only a review that came from Google with its own id can be replied to there. AI drafts are written from the review text and your settings, stay drafts until you publish them, and can get facts wrong, so read every one.",
  needs: ["A connected Google account and a linked location (Google Business → Locations)."],
};
export default entry;
