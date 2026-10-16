import type { HelpDraft } from "../../types";

/** Written from client/src/pages/yelp.tsx and server/yelp/service.ts (list, refresh, competitors, draftReply) as they run. */
const entry: HelpDraft = {
  key: "yelp.reviews-and-replies", parent: "yelp", group: "Reviews", route: "/yelp", title: "Yelp → Reviews, replies and competitors",
  whatItIs: "The newest Yelp reviews of a connected business, an AI draft of your reply to each, and the nearby competitors in your category.",
  whatItDoes: "Each business card shows the few newest reviews Yelp returns, with the reviewer's name, stars and the start of their words. “Draft reply with AI” writes a short owner reply from the review's own facts for you to copy. “Respond on Yelp” opens the review on Yelp, where you post it. “Competitors on Yelp” lists up to six businesses in the same category near yours, best-rated first, and marks the ones rated ahead of you.",
  howToUse: [
    "Choose “Draft reply with AI” under a review and change anything that is not right.",
    "Choose Copy, then “Respond on Yelp”, and paste the reply there; Yelp has no way for ConstructHUB to post it.",
    "Choose Redraft for another version.",
    "Open “Competitors on Yelp” at the bottom of the card to see who is ahead and by how much.",
  ],
  howItWorks: "The business is refreshed from Yelp when its data is over 12 hours old, or when you choose Refresh. A new review sends you a notification with the newest review. The reply is drafted from the business name, the reviewer’s name, the star rating and the review text only, and the AI is told never to invent services, visits, prices or offers; check every draft. Competitors come from a Yelp search in the business's first category around its location.",
  needs: ["A connected Yelp business.", "AI drafts need the AI service set up on the server."],
};
export default entry;
