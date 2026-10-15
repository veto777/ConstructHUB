import type { HelpDraft } from "../../types";

/** Written from client/src/pages/gbp-content.tsx ("Calendar, queue & history") and server/gbp/content.ts (/refresh, /jobs/:job, runContentWorker) as they run. */
const entry: HelpDraft = {
  key: "posts-photos.calendar-queue-and-history", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → Calendar, queue and history",
  whatItIs: "Every post and photo item of the location (queued, published, failed, canceled), as a list or as a calendar by day.",
  whatItDoes: "Queue lists the items newest first; Calendar groups them under the day they are due. Each item shows its kind, time and status and, once published, Google's own status. Refresh Google status asks Google about the published posts, Cancel takes a queued item out, and Retry puts a failed item back in. An uncertain item asks you to check Google first, because retrying could publish it twice.",
  howToUse: [
    "Open Posts & Photos under Google Business, choose a linked location, and scroll to Calendar, queue & history.",
    "Choose Queue for the newest-first list, or Calendar to see items under their day.",
    "Choose Refresh Google status to read the latest state of the published posts.",
    "Choose Cancel on a queued item you no longer want, or Retry on a failed one.",
    "Check your Google listing before choosing Retry on an item marked uncertain.",
  ],
  howItWorks: "The list refreshes itself every 15 seconds. The server marks an item published when Google accepts it and sends you a notice; a post Google rejects shows Google's reason; a publish that was interrupted is marked uncertain and is never re-sent on its own. Refresh Google status reads each published post from Google and marks it rejected if Google has since rejected it. Cancel works on queued, failed and uncertain items; Retry on failed ones, and on uncertain ones only after you confirm you checked Google.",
  needs: ["Any plan.", "A location linked to its Google Business Profile."],
};
export default entry;
