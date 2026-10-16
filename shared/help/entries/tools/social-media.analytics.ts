import type { HelpDraft } from "../../types";

/** Written from client/src/components/social-insights.tsx (the Analytics view) as it runs. */
const entry: HelpDraft = {
  key: "social-media.analytics", parent: "social-media", group: "Tools", route: "/social-media", title: "Social Media → Analytics",
  whatItIs: "How the business’s connected accounts and published posts are doing.",
  whatItDoes: "It shows one tile per connected account with followers and the reach, views and engagement over the last 7 or 28 days, as the network reports them. TikTok tiles show following, posts and likes instead. It also lists published posts with each one’s likes, comments, shares and views. A post can be deleted from the network here.",
  howToUse: [
    "Open Analytics for the business.",
    "Switch the tiles between 7 and 28 days.",
    "Open a published post to read its numbers.",
    "Choose Delete on a post to remove it from the network; this cannot be undone.",
  ],
  howItWorks: "Numbers come from each network’s own reporting for accounts connected through ConstructHUB’s own apps; a network that gives no figure shows a dash with the reason. Deleting a post asks the network to remove it and marks the post deleted here.",
};
export default entry;
