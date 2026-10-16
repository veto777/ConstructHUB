import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (PostsTab) and client/src/pages/gbp-content.tsx (GbpContentEditor) as they run. */
const entry: HelpDraft = {
  key: "locations.posts-and-updates", parent: "locations", group: "Google Business", route: "/locations", title: "Locations → Posts & Updates",
  whatItIs: "The Posts & Updates tab of a linked location: the Posts tool, already set to this location.",
  whatItDoes: "It is the same editor as Posts under Google Business. Write a Google update, event or offer, or let the AI draft one in your saved style, then attach up to ten photos from your library, choose when it goes out and approve it. Bulk posts turn a folder of photos into a run of posts spaced out over time. The queue and history at the bottom show every post for this location with its Google status.",
  howToUse: [
    "Open a linked location under Locations and choose Posts & Updates.",
    "Write the update under “Compose a Google update”, or generate a draft and edit it.",
    "Set “First publish” (blank means now) and, if you want, how often and in which hours under Advanced schedule.",
    "Choose “Approve & queue post” and follow it under “Calendar, queue & history”.",
  ],
  howItWorks: "Approving writes one queued job per post with its time. ConstructHUB sends each one to Google at that time in the background and records Google's answer. Nothing is published until you approve. Photos have their own tab; this tab is posts only.",
  needs: ["Any plan.", "A location linked to its Google Business Profile."],
};
export default entry;
