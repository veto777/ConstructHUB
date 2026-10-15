import type { HelpDraft } from "../../types";

/** Written from client/src/pages/agency.tsx (Jobs tab) and server/agency/jobs.ts (queueBulk, performJob, runAgencyJobs, scheduleSyncs) as they run. */
const entry: HelpDraft = {
  key: "agency.jobs", parent: "agency", group: "Google Business", route: "/agency", title: "Agency → Jobs",
  whatItIs: "The record of every Google action queued on your client locations, and how each one went.",
  whatItDoes: "It counts the jobs waiting, running, done and failed, then lists them newest first. Each row shows the location, the action (a sync, link, unlink, client assignment, Watch mode, AI reply setting, post or photo batch, or Site Scan), the client, its times and the reason if it failed. Search narrows the list by location, and Open location jumps to it. The list refreshes itself every ten seconds.",
  howToUse: [
    "Queue the work on the Locations tab: tick locations, pick the action, choose Queue selected action.",
    "Open the Jobs tab under Agency to follow it.",
    "Read a failed row's reason and fix the cause on the location, for example reconnect Google.",
    "Queue the action again on Locations; there is no retry button here.",
  ],
  howItWorks: "Each bulk action becomes one job per location. The server runs jobs in the background every fifteen seconds, ten at a time, taking turns between workspaces. Your access is checked again when a job runs, so a location you lost is skipped. A passing Google error is retried up to five times with growing waits, a Google quota limit waits an hour, and work other than syncs stops when the owner's plan no longer includes the agency workspace.",
  needs: ["The Agency workspace (the agency module; which plan carries it comes from the plan model).", "A role that can change locations to queue work: owner, admin or manager."],
};
export default entry;
