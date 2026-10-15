import type { HelpDraft } from "../../types";

/** Written from client/src/components/agency-workspace.tsx (AgencyBulkWorkspace) and server/agency/jobs.ts as they run. */
const entry: HelpDraft = {
  key: "locations.bulk-tools-on-agency", parent: "locations", group: "Google Business", route: "/locations",
  title: "Locations → Bulk tools on Agency",
  whatItIs: "The bulk actions of the Agency workspace: one action across many client locations at once.",
  whatItDoes: "Every location in the list has a tick box; Select page and Select all matching take a whole page or filter. Apply to selected locations offers Sync now, Link & sync, Unlink, Assign client, Set Watch mode, AI reply settings, a scheduled post or photo batch, and Site Scans. Queue selected action sends one job per location to the queue; Jobs lists each with its status and any failure.",
  howToUse: [
    "Sidebar → Google Business → Agency (the Locations view).",
    "Tick the locations, or use Select page or Select all matching.",
    "Under Apply to selected locations, pick the action and its settings.",
    "Choose Queue selected action, then follow the jobs under Agency → Jobs.",
  ],
  howItWorks: "Each queued action becomes one job per location, run by a background worker a few seconds later; a location you lose access to while a job waits is skipped. Set Watch mode needs a previously approved snapshot on each location and fails safely where there is none. Unlink removes the synced Google data in ConstructHUB and never changes the listing on Google.",
  needs: ["The Agency workspace (the agency module; which plan carries it comes from the plan model).", "A role in the workspace that can change locations: owner, admin or manager."],
};
export default entry;
