import type { HelpDraft } from "../../types";

/** Written from client/src/components/agency-workspace.tsx (AgencyBulkWorkspace) and server/agency/jobs.ts as they run. */
const entry: HelpDraft = {
  key: "locations.bulk-tools-on-agency", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Bulk tools on Agency",
  whatItIs: "The bulk actions of the Agency workspace: one action across many client locations at once.",
  whatItDoes: "Every location in the list has a tick box, and Select page or Select all matching takes a whole page or filter. Apply to selected locations offers Sync now, Link & sync, Unlink, Assign client, Set Watch mode, AI reply settings, a scheduled post or photo batch, and Site Scans. Queue selected action sends one job per location, and the Jobs tab lists each with its status and any failure.",
  howToUse: [
    "Open Agency under Google Business in the sidebar; it opens on the Locations view.",
    "Tick the locations, or use Select page or Select all matching.",
    "Pick the action and its settings under Apply to selected locations.",
    "Choose Queue selected action, then follow the jobs under the Jobs tab.",
  ],
  howItWorks: "Each queued action becomes one job per location, run in the background a few seconds later. A location you lose access to while a job waits is skipped. Set Watch mode needs an approved saved copy of the listing on each location and fails safely where there is none. Unlink removes the Google data ConstructHUB holds and never changes the listing on Google.",
  needs: ["The Agency workspace (the agency module; which plan carries it comes from the plan model).", "A role in the workspace that can change locations: owner, admin or manager."],
};
export default entry;
