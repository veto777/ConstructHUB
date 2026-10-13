import type { HelpDraft } from "../../types";

/** Written from client/src/pages/gbp-content.tsx ("Calendar, queue & history") and server/gbp/content.ts (/refresh, /jobs/:job, runContentWorker) as they run. */
const entry: HelpDraft = {
  key: "posts-photos.calendar-queue-and-history", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → Calendar, queue and history",
  whatItIs: "The list of every post and photo item of the location — queued, published, failed, cancelled — as a queue or as a calendar by day.",
  whatItDoes: "Queue lists the items newest first; Calendar groups them under the day they are due. Each item shows its kind, its time, its status and, once published, Google’s own status and the Google resource name. Refresh Google status asks Google about the published posts. Cancel takes a queued item out; Retry puts a failed item back in the queue. An uncertain item asks you to check Google first, because retrying could publish it twice.",
  howToUse: [
    "Sidebar → Google Business → Posts & Photos, choose a linked location, and scroll to Calendar, queue & history.",
    "Choose Queue for the newest-first list, or Calendar to see the items under their day.",
    "Choose Refresh Google status to read the latest state of the published posts from Google.",
    "Choose Cancel on a queued item you no longer want. A failed item shows its error and a Retry button.",
    "On an item marked uncertain, check your Google profile before choosing Retry.",
  ],
  howItWorks: "The list refreshes itself every 15 seconds. The worker marks an item published when Google accepts it and sends you a notice; a post Google rejects is marked rejected with Google’s reason so you can correct it; a publish that was interrupted is marked uncertain and is never re-sent on its own. Refresh Google status reads each published post from Google and marks a post rejected if Google has since rejected it. Cancel works on queued, failed and uncertain items; Retry on failed items, and on uncertain items only after you confirm you checked Google.",
  needs: ["Any plan.", "A location linked to its Google Business Profile."],
};
export default entry;
