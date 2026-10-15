import type { HelpDraft } from "../../types";

/** Written from client/src/pages/gbp-content.tsx ("Compose a Google update") and server/gbp/content.ts itemInput as they run. */
const entry: HelpDraft = {
  key: "posts-photos.updates-events-and-offers", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → Updates, events and offers",
  whatItIs: "The Compose a Google update section: the three kinds of post a Google Business Profile shows, written for one linked location.",
  whatItDoes: "Post type is Standard, Event or Offer. Every type takes up to 1,500 characters and the first 10 photos you ticked. A Standard or Event post can carry a button (Book, Order, Shop, Learn more, Sign up or Call) with its link. An Event or Offer has a title, a Starts time and an Ends time in the location's local time, and an Offer can carry a coupon code.",
  howToUse: [
    "Open Posts & Photos under Google Business and choose a linked location.",
    "Pick the Post type under Compose a Google update: Standard, Event or Offer.",
    "Write the text in the Post draft box; the counter shows how many of 1,500 characters are used.",
    "Add a Call to action with its Action URL, or the title, Starts and Ends (and a coupon code for an Offer).",
    "Choose Approve & queue post under Schedule and approve, or Add post to draft batch to write the next one first.",
  ],
  howItWorks: "The post is sent to Google as a post of the chosen type at its scheduled time. An Offer has no button, so that field is hidden when Offer is chosen. Event and offer times are sent as the location's local time. Nothing reaches Google until you approve the post.",
  needs: ["Any plan.", "A location linked to its Google Business Profile."],
};
export default entry;
