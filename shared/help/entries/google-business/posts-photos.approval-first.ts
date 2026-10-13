import type { HelpDraft } from "../../types";

/** Written from client/src/pages/gbp-content.tsx ("Compose a Google update", "Schedule and approve") and server/gbp/content.ts (/queue, enqueue) as they run. */
const entry: HelpDraft = {
  key: "posts-photos.approval-first", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → Approval first",
  whatItIs: "The rule behind Posts & Photos: a post or a photo caption, typed or drafted by AI, stays a draft until you approve it, and approving is what authorizes publishing.",
  whatItDoes: "Approve & queue post queues the current post, or every post in the draft batch; Approve & queue photos queues one item per ticked photo. Add post to draft batch keeps up to 100 posts to approve together, each still editable in its Draft box. Until you approve, nothing is queued: unsaved drafts are lost if you reload the page.",
  howToUse: [
    "Sidebar → Google Business → Posts & Photos, and choose a linked location.",
    "Write a post under Compose a Google update, or generate a draft and edit it.",
    "To approve several at once, choose Add post to draft batch after each one; the batch lists them as Draft 1, Draft 2 and so on, with a Remove button each.",
    "Read the text once more, then choose Approve & queue post. With a draft batch, approval queues only the posts in that batch.",
    "The queued items appear at the top of Calendar, queue & history with the status queued.",
  ],
  howItWorks: "Approving sends the items to the server, which writes one queued job per item with its scheduled time; the publishing worker sends each job to Google at that time. A resubmit of the same approval is recognised and does not queue the items twice. Approve & queue photos is off until a photo is ticked, and Approve & queue post is off while the Post draft is empty and the batch is too.",
  needs: ["Any plan.", "A location linked to its Google Business Profile."],
};
export default entry;
