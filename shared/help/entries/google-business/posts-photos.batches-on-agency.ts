import type { HelpDraft } from "../../types";

/** Written from client/src/components/agency-workspace.tsx ("Schedule post/photo batch") and server/agency/jobs.ts (content → enqueue) as they run. */
const entry: HelpDraft = {
  key: "posts-photos.batches-on-agency", parent: "posts-photos", group: "Google Business", route: "/gbp-content", title: "Posts & Photos → Batches on Agency",
  whatItIs: "A bulk action on the Agency page, also under Agency bulk actions at the bottom of Posts & Photos: one post or photo batch queued for many client locations at once.",
  whatItDoes: "You tick the locations and pick Schedule post/photo batch under Apply to selected locations. Content kind is Post or Photo batch, Approved content is the text, Media photo IDs names the library photos (comma separated), and Batch start time is when the first item publishes. Approve & queue batch queues one job per location.",
  howToUse: [
    "Open Agency under Google Business, or Agency bulk actions at the bottom of Posts & Photos.",
    "Tick the locations, or choose Select all matching after filtering by client or status.",
    "Choose Schedule post/photo batch under Apply to selected locations and pick the Content kind.",
    "Type the Approved content, add Media photo IDs if the batch has photos, and set the Batch start time.",
    "Choose Approve & queue batch, then follow progress and failures under the Jobs tab.",
  ],
  howItWorks: "Each selected location gets a job that puts the content into that location's own Posts & Photos queue, starting at the batch start time. The items then publish the same way, under the same daily cap, and show in each location's Calendar, queue & history. Queueing the batch is the approval. Photos must belong to the agency, and a viewer in the workspace cannot queue a batch.",
  needs: ["An agency workspace with a role other than viewer.", "Client locations linked to their Google Business Profiles."],
};
export default entry;
