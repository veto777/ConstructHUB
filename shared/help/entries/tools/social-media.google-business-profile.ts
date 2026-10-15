import type { HelpDraft } from "../../types";

/** Written from client/src/pages/social-media.tsx (the Google Business Profile channel) and server/gbp/content.ts as it runs. */
const entry: HelpDraft = {
  key: "social-media.google-business-profile", parent: "social-media", group: "Tools", route: "/social-media", title: "Social Media → Google Business Profile",
  whatItIs: "The Google Business Profile channel of the composer: the same post, published as an update on the business's Google listing.",
  whatItDoes: "When the business is linked to a Google listing, the composer shows a Google Business Profile box next to the social accounts. Ticked, it sends the post text as a standard Google update for that one location, with an optional photo from your Media Library, at the schedule time you typed or right away. The channel gets its own text tweak with a 1,500-character limit. When the business is not linked, the box is replaced by a link to Locations, where the listing is linked.",
  howToUse: [
    "Open New post for the business and tick Google Business Profile.",
    "Pick a photo from your Media Library if you want one on the Google update.",
    "Write the text, or edit the Google text tweak to say it differently on Google.",
    "Type a schedule date and time, or leave it blank to publish now, then choose Post now or Schedule post.",
    "Follow the Google update under Google Business \u2192 Posts, where it is listed with its Google status.",
  ],
  howItWorks: "The channel uses the Google posts queue that Google Business \u2192 Posts uses, not the social queue: it queues one post item for the linked location with the text, the photo and the first-publish time, and the same background worker publishes it to Google. The request carries a key that is kept until Google accepted the post, so a retry replays it instead of queuing a second copy. The queue holds approved posts only, which is why Save draft does not send a Google copy. Google posts are counted and gated like posts made on the Posts page.",
  needs: ["A business linked to its Google Business Profile in Locations.", "The plan module that includes Google posts on a schedule, the same one the Posts page needs."],
};
export default entry;
