import type { HelpDraft } from "../../types";
import { MODULE_NAMES, PLANS, planForModule } from "../../../plans";

/** Written from client/src/pages/gbp-content.tsx ("Calendar, queue & history") and server/gbp/content.ts (/refresh, /jobs/:job, runContentWorker) as they run. */
const entry: HelpDraft = {
  key: "posts-photos.calendar-queue-and-history", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → Calendar, queue and history",
  whatItIs: "Every post (on Posts) or photo (on Photos) of the location, queued, published, failed, rejected, uncertain or canceled, as a list or as a calendar by day.",
  whatItDoes: "Queue lists the items newest first; Calendar groups them under the day they are due. Each item shows its kind, time and status and, once published, Google's own status. Refresh Google status asks Google about the published posts, Cancel takes a queued item out, and Retry puts a failed item back in. An uncertain item asks you to check Google first, because retrying could publish it twice.",
  howToUse: [
    "Open Posts or Photos under Google Business, choose a linked location, and scroll to Calendar, queue & history.",
    "Choose Queue for the newest-first list, or Calendar to see items under their day.",
    "Choose Refresh Google status to read the latest state of the published posts.",
    "Choose Cancel on a queued item you no longer want, or Retry on a failed one.",
    "Check your Google listing before choosing Retry on an item marked uncertain.",
  ],
  howItWorks: "The list refreshes itself every 15 seconds. An item is marked published when Google accepts it, and you get a notice; a post Google rejects is marked rejected, with a note to check Google's content policies and write a corrected post, and one cut off mid-send is marked uncertain and never re-sent on its own. Refresh Google status checks each published post with Google and marks it rejected if Google has since rejected it. Cancel works on queued, failed and uncertain items; Retry on failed ones, and on uncertain ones only after you confirm you checked Google.",
  needs: [`The ${PLANS[planForModule("autoPosts")].name} plan, which includes the “${MODULE_NAMES.autoPosts}” module.`, "A location linked to its Google Business Profile."],
};
export default entry;
