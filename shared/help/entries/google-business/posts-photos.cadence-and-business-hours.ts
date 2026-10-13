import type { HelpDraft } from "../../types";

/** Written from client/src/pages/gbp-content.tsx ("Schedule and approve") and server/gbp/content.ts (scheduleInput, scheduleTimes, runContentWorker) as they run. */
const entry: HelpDraft = {
  key: "posts-photos.cadence-and-business-hours", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → Cadence and business hours",
  whatItIs: "The Schedule and approve section: when the first item publishes, how the rest are spaced, and the weekdays and hours they may publish in.",
  whatItDoes: "First publish sets the first item’s time; blank publishes the first item now. Under Advanced schedule, Items per period and Cadence spread the approved set per day or per week, or Custom times gives each item its own time. Business hours only adds a time zone, an opening and closing hour and the weekdays to publish on; an item that falls outside them moves to the next open slot.",
  howToUse: [
    "Sidebar → Google Business → Posts & Photos, choose a linked location, and compose the posts or tick the photos.",
    "Under Schedule and approve, set First publish, or leave it blank to start now.",
    "Open Advanced schedule and set Items per period and Cadence: Per day, Per week or Custom times.",
    "Tick Business hours only, check the Timezone, Opening hour and Closing hour, and tick the weekdays.",
    "Choose Approve & queue photos or Approve & queue post. Each item shows its time in Calendar, queue & history.",
  ],
  howItWorks: "Cadence sets elapsed spacing: with 3 per week, the second item is scheduled 56 hours after the first. The spacing applies to the ticked photos or to the posts in the draft batch; without a batch only the current post is scheduled. With business hours on, a time outside the chosen weekdays and hours moves to the next open hour in the time zone, and that is checked again right before publishing, so closed hours can move an item to a later day. The schedule spaces out what you approved; it does not write new posts on its own. A daily publishing cap keeps the pace steady.",
  needs: ["Any plan.", "A location linked to its Google Business Profile."],
};
export default entry;
