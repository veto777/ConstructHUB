import type { HelpDraft } from "../../types";

/** Written from client/src/pages/locations.tsx (PostsTab) and client/src/pages/gbp-content.tsx (GbpContentEditor) as they run. */
const entry: HelpDraft = {
  key: "locations.posts-and-updates", parent: "locations", group: "Google Business", route: "/locations", title: "Locations → Posts & Updates",
  whatItIs: "The Posts & Updates tab of a linked location: the Posts tool, already set to this location.",
  whatItDoes: "It is the same editor as Google Business → Posts: write a Google update, event or offer or let the AI draft one in your saved style, attach up to ten photos from your library, choose when it goes out and approve it. Bulk posts turn a folder of photos into a run of posts on a cadence. The queue and history at the bottom show every post for this location with its Google status.",
  howToUse: [
    "Locations → open a linked location → Posts & Updates.",
    "Write the update under “Compose a Google update”, or generate a draft and edit it.",
    "Set “First publish” (blank means now) and, if you want, the cadence, custom times or business hours under Advanced schedule.",
    "Choose “Approve & queue post”; follow it under “Calendar, queue & history”.",
  ],
  howItWorks: "Approving writes one queued job per post with its time; the publishing worker sends each job to Google at that time and records Google’s answer. Nothing is published until you approve. Photos have their own tab; this tab is posts only.",
  needs: ["Any plan.", "A location linked to its Google Business Profile."],
};
export default entry;
