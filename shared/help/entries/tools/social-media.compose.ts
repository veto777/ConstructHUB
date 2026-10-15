import type { HelpDraft } from "../../types";

/** Written from client/src/pages/social-media.tsx (the Compose view) as it runs. */
const entry: HelpDraft = {
  key: "social-media.compose", parent: "social-media", group: "Tools", route: "/social-media", title: "Social Media → New post",
  whatItIs: "Where you write one post and send it to every account you tick, plus your Google Business Profile.",
  whatItDoes: "It lists the social accounts connected for the business with a box to tick for each, and a Google Business Profile box when the business is linked to a Google listing. You write the text once; each network you ticked gets its own copy you can tweak, with its character count. Media is a public link, an upload of up to 100 MB, or a synced business photo, and the schedule time is a date and time you type (blank means now). Post now sends the post, Schedule post holds it for that time, and Save draft keeps it in the Posts list without sending.",
  howToUse: [
    "Pick the business in the Business menu and open New post.",
    "Tick the accounts to post to; for Facebook, LinkedIn, Pinterest, Reddit and Tumblr choose the page, board, subreddit or blog, YouTube, Pinterest and Reddit also need a title, and TikTok asks who can view the post.",
    "Tick Google Business Profile to send the same update to your Google listing; a Media Library photo can go with it.",
    "Write the text, attach media if the network needs it, and type a schedule date and time or leave it blank for now.",
    "Choose Post now, Schedule post or Save draft, then follow the post under Posts.",
  ],
  howItWorks: "Unsent work is kept in this browser for the business and comes back when you return. Instagram, TikTok, Pinterest and YouTube refuse a post without media. A post is sent to each ticked account with one request id, so a retry after a dropped connection confirms the result instead of posting twice. The Google Business Profile copy does not go through the social queue: it is handed to the Google posts list that Google Business → Posts uses, as one standard update for the linked location at the same time, and its status is shown there; Google holds only approved posts, so a draft keeps its Google copy in this composer.",
  needs: ["A business with at least one connected social account, or a business linked to a Google Business Profile in Locations."],
};
export default entry;
