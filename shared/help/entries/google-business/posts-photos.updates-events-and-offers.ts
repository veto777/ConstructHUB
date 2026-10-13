import type { HelpDraft } from "../../types";

/** Written from client/src/pages/gbp-content.tsx ("Compose a Google update") and server/gbp/content.ts itemInput as they run. */
const entry: HelpDraft = {
  key: "posts-photos.updates-events-and-offers", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → Updates, events and offers",
  whatItIs: "The Compose a Google update section: the three kinds of post a Google Business Profile shows, written for one linked location.",
  whatItDoes: "Post type is Standard, Event or Offer. Every type takes up to 1,500 characters of text and attaches the first 10 photos you ticked. A Standard or Event post can carry a button — Book, Order, Shop, Learn more, Sign up or Call — with an Action URL. An Event or Offer has a title, a Starts time and an Ends time in the Google location’s local time; an Offer can also carry a coupon code. Add post to draft batch keeps several posts to approve together.",
  howToUse: [
    "Sidebar → Google Business → Posts & Photos, and choose a linked location.",
    "Under Compose a Google update, pick the Post type: Standard, Event or Offer.",
    "Write the text in the Post draft box; the counter shows how many of 1,500 characters are used.",
    "For a Standard or Event post, choose a Call to action and type its Action URL. For an Event or Offer, fill in the title, Starts and Ends; an Offer can take a coupon code.",
    "Choose Approve & queue post under Schedule and approve, or Add post to draft batch to write the next one first.",
  ],
  howItWorks: "The post is sent to Google as a local post of the chosen topic type at its scheduled time. An Offer has no call-to-action button, so that field is hidden when Offer is chosen. Event and offer times are sent as the location’s local time. Nothing reaches Google until you approve the post.",
  needs: ["Any plan.", "A location linked to its Google Business Profile."],
};
export default entry;
