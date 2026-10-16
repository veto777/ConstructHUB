import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ads-manager.tsx (Queue), server/ads/routes.ts GET /jobs and server/ads/worker.ts as they run. */
const entry: HelpDraft = {
  key: "ads-manager.queue", parent: "ads-manager", group: "Google Ads", route: "/ads-manager", title: "Agency Ads & LSA → Queue",
  whatItIs: "The Queue section of the Agency Ads & LSA manager: every background job this manager has sent to Google, newest first.",
  whatItDoes: "Every button here that talks to Google adds a job to the list: Discover clients, Poll invitations, Link account, invitations and their emails, health audits, previews, undo previews and applying a confirmed preview. Each row shows the client’s customer ID (or Agency for the whole manager account), the kind of job and Google’s error if it failed. Status is Queued, Running, Done, Failed, Unknown or Cancelled. The search box matches a customer ID or a kind, Filters keeps one status, and the list refreshes itself every few seconds.",
  howToUse: [
    "Open Google Ads → Agency → Queue in the sidebar.",
    "Read a row’s status; a Failed row shows the reason under its details.",
    "Type a customer ID in the search box to follow one client’s jobs, or open Filters and pick a status.",
    "Open the section a Done job belongs to: Client accounts, Access invitations, Protection previews or Health audit.",
  ],
  howItWorks: "ConstructHUB runs the jobs in the background, one at a time, and saves each result. When the page says “Ads jobs are paused for now”, jobs stay Queued until they are switched back on. A job whose outcome Google did not confirm is marked Unknown rather than Done: check the account in Google Ads before queuing the same change again.",
  needs: ["A plan that includes the Agency Ads & LSA module.", "A connected Google Ads manager (MCC) account."],
};
export default entry;
