import type { HelpDraft } from "../../types";

/** Written from client/src/pages/social-media.tsx (the Compose view) as it runs. */
const entry: HelpDraft = {
  key: "social-media.compose", parent: "social-media", group: "Tools", route: "/social-media", title: "Social Media → New post",
  whatItIs: "Where you write one post and send it to every account you tick, plus your Google Business Profile.",
  whatItDoes: "It lists the business’s connected social accounts with a box to tick for each, plus a Google Business Profile box when the business is linked to a Google listing. You write the text once, and each network you ticked gets its own copy you can tweak, with its character count. Media is a public link, an upload of up to 100 MB, or a business photo pulled from Google, and a blank schedule time means now. Post now sends it, Schedule post holds it for that time, and Save draft keeps it in Posts without sending.",
  howToUse: [
    "Pick the business in the Business menu and open New post.",
    "Tick the accounts to post to, and fill in what each asks for (a page, board, subreddit or blog; a title; or, on TikTok, who can view it).",
    "Tick Google Business Profile to send the same update to your Google listing; a Media Library photo can go with it.",
    "Write the text, attach media if the network needs it, and type a schedule date and time or leave it blank for now.",
    "Choose Post now, Schedule post or Save draft, then follow the post under Posts.",
  ],
  howItWorks: "Unsent work is kept in this browser and comes back when you return. Instagram, TikTok, Pinterest and YouTube refuse a post without media. A retry after a dropped connection checks the result instead of posting twice. The Google Business Profile copy goes to the Google posts list under Google Business → Posts, where its status shows; Google gets only approved posts, so a draft keeps its Google copy here.",
  needs: ["A business with at least one connected social account, or a business linked to a Google Business Profile in Locations."],
};
export default entry;
