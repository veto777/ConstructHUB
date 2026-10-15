import type { HelpDraft } from "../../types";

/** Written from client/src/pages/agency.tsx (Jobs tab) and server/agency/jobs.ts (queueBulk, performJob, runAgencyJobs, scheduleSyncs) as they run. */
const entry: HelpDraft = {
  key: "agency.jobs", parent: "agency", group: "Google Business", route: "/agency", title: "Agency → Jobs",
  whatItIs: "The record of every queued Google action on your client locations and how each one went.",
  whatItDoes: "Counts the jobs queued, running, done and failed, then lists them newest first: the location, the action (Sync now, Link & sync, Unlink, Assign client, Set Watch mode, AI reply settings, a post or photo batch, a Site Scan), the client, when it was queued and finished, and the reason when it failed. Search narrows the list by location. Open location jumps to the location itself. The list refreshes itself every ten seconds.",
  howToUse: [
    "Queue the work on Locations: tick locations, choose the action under Apply to selected locations, then Queue selected action. Google syncs are also queued on their own every six hours.",
    "Sidebar → Google Business → Agency → Jobs to follow it.",
    "Read a failed row's reason; fix the cause on the location (for example reconnect Google or approve a Profile Watch snapshot) and queue the action again on Locations.",
  ],
  howItWorks: "Each bulk action becomes one job per location, run by a background worker every fifteen seconds, ten at a time, taking turns between workspaces so no one is starved. The member's access is checked again when the job runs, so a revoked client or location is skipped. A Google error that may pass is retried up to five times with growing delays; a Google quota limit waits an hour; a job that is not allowed fails at once with the reason. Work other than syncs stops when the owner's plan no longer includes the agency workspace, and says so on the row. There is no retry button: queue the action again on Locations.",
  needs: ["The Agency workspace (the agency module; which plan carries it comes from the plan model).", "A role that can change locations to queue work: owner, admin or manager."],
};
export default entry;
