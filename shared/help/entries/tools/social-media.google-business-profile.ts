import type { HelpDraft } from "../../types";

/** Written from client/src/pages/social-media.tsx (the Google Business Profile channel) and server/gbp/content.ts as it runs. */
const entry: HelpDraft = {
  key: "social-media.google-business-profile", parent: "social-media", group: "Tools", route: "/social-media", title: "Social Media → Google Business Profile",
  whatItIs: "The Google Business Profile channel of the composer: the same post, published as an update on the business’s Google listing.",
  whatItDoes: "When the business is linked to a Google listing, the composer shows a Google Business Profile box next to the social accounts; when it is not, the box is a link to Locations. Ticked, it sends the post text as a Google update for that one location, at the time you typed or right away, with an optional Media Library photo. The Google copy gets its own text with a 1,500-character limit.",
  howToUse: [
    "Open New post for the business and tick Google Business Profile.",
    "Pick a photo from your Media Library if you want one on the Google update.",
    "Write the text, or edit the Google text tweak to say it differently on Google.",
    "Type a schedule date and time, or leave it blank to publish now, then choose Post now or Schedule post.",
    "Follow the Google update under Google Business → Posts, where it is listed with its Google status.",
  ],
  howItWorks: "It adds one post for the linked location to the same Google posts list as Google Business → Posts, and it goes to Google the same way those posts do. A retry never adds a second copy. The list holds approved posts only, which is why Save draft does not send a Google copy. Google posts are counted and limited like posts made on the Posts page.",
  needs: ["A business linked to its Google Business Profile in Locations.", "The plan module that includes Google posts on a schedule, the same one the Posts page needs."],
};
export default entry;
