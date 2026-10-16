import type { HelpDraft } from "../../types";
import { MODULE_NAMES, PLANS, planForModule } from "../../../plans";

/** Written from client/src/pages/gbp-content.tsx ("Schedule and approve") and server/gbp/content.ts (scheduleInput, scheduleTimes, runContentWorker) as they run. */
const entry: HelpDraft = {
  key: "posts-photos.cadence-and-business-hours", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → Cadence and business hours",
  whatItIs: "The Schedule and approve section: when the first item publishes, how often the rest follow, and the weekdays and hours they may publish in.",
  whatItDoes: "First publish sets the first item's time; blank publishes it now. Under Advanced schedule, Items per period and Cadence (how often) spread the approved set per day or per week, or Custom times gives each item its own time. Business hours only adds a time zone, an opening and closing hour and the weekdays to publish on. A scheduled item that falls outside them moves to the next open hour. A custom time outside them is refused.",
  howToUse: [
    "Open Posts or Photos under Google Business, choose a linked location, and write the posts or tick the photos.",
    "Set First publish under Schedule and approve, or leave it blank to start now.",
    "Open Advanced schedule and set Items per period and Cadence: Per day, Per week or Custom times.",
    "Tick Business hours only, check the Timezone, Opening hour and Closing hour, and tick the weekdays.",
    "Choose Approve & queue photos or Approve & queue post, then read each item's time in Calendar, queue & history.",
  ],
  howItWorks: "The spacing is plain elapsed time: with 3 per week, the second item is set 56 hours after the first. It applies to the ticked photos or the posts in the draft batch; without a batch only the current post is scheduled. With business hours on, a Per day or Per week time outside the chosen days and hours moves to the next open hour, checked again right before publishing, so an item can move to a later day. A custom time outside them is refused, so pick one inside the hours. The schedule only spaces out what you approved and never writes new posts on its own.",
  needs: [`The ${PLANS[planForModule("autoPosts")].name} plan, which includes the “${MODULE_NAMES.autoPosts}” module.`, "A location linked to its Google Business Profile."],
};
export default entry;
