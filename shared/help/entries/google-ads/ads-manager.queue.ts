import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ads-manager.tsx (Queue), server/ads/routes.ts GET /jobs and server/ads/worker.ts as they run. */
const entry: HelpDraft = {
  key: "ads-manager.queue", parent: "ads-manager", group: "Google Ads", route: "/ads-manager", title: "Agency Ads & LSA → Queue",
  whatItIs: "The Queue section of the Agency Ads & LSA manager: every background job this manager has sent to Google, newest first.",
  whatItDoes: "Every button that talks to Google here adds a job: Discover clients, Poll invitations, Link account, an invitation and its instruction email, a health audit, a protection preview, a reversal preview and the apply of a confirmed preview. Each row shows the client’s customer ID (or Agency for a job about the whole manager account), the kind of job, its status (Queued, Running, Done, Failed, Unknown or Cancelled) and Google’s error when it failed. The search box matches a customer ID or a kind, Filters keeps one status, and the list refreshes itself every few seconds.",
  howToUse: [
    "Open Google Ads → Agency → Queue in the sidebar.",
    "Read a row’s status; a Failed row shows the reason under its details.",
    "Type a customer ID in the search box to follow one client’s jobs, or open Filters and pick a status.",
    "Open the section a Done job belongs to: Client accounts, Access invitations, Protection previews or Health audit.",
  ],
  howItWorks: "The server runs the jobs in the background, one at a time, and saves each result. When the page says the Ads worker is off, jobs stay Queued until it is switched on. A job whose outcome Google did not confirm is marked Unknown rather than Done: check the account in Google Ads before queuing the same change again.",
  needs: ["A plan that includes the Agency Ads & LSA module.", "A connected Google Ads manager (MCC) account."],
};
export default entry;
