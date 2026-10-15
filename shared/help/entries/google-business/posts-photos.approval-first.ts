import type { HelpDraft } from "../../types";

/** Written from client/src/pages/gbp-content.tsx ("Compose a Google update", "Schedule and approve") and server/gbp/content.ts (/queue, enqueue) as they run. */
const entry: HelpDraft = {
  key: "posts-photos.approval-first", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → Approval first",
  whatItIs: "The rule behind Posts & Photos: a post or caption, typed or drafted by AI, stays a draft until you approve it. Approving is what allows publishing.",
  whatItDoes: "Approve & queue post queues the current post, or every post in the draft batch. Approve & queue photos queues one item per ticked photo. Add post to draft batch keeps up to 100 posts to approve together, each still editable. Until you approve, nothing is queued, and unsaved drafts are lost if you reload the page.",
  howToUse: [
    "Open Posts & Photos under Google Business and choose a linked location.",
    "Write a post under Compose a Google update, or generate a draft and edit it.",
    "Choose Add post to draft batch after each one to approve several at once; each gets a Remove button.",
    "Read the text once more, then choose Approve & queue post.",
    "Find the queued items at the top of Calendar, queue & history with the status queued.",
  ],
  howItWorks: "Approving sends the items to the server, which writes one queued job per item with its time. The server then sends each job to Google at that time in the background. Sending the same approval twice is recognized and does not queue the items twice. Approve & queue photos is off until a photo is ticked, and Approve & queue post is off while the Post draft and the batch are both empty.",
  needs: ["Any plan.", "A location linked to its Google Business Profile."],
};
export default entry;
