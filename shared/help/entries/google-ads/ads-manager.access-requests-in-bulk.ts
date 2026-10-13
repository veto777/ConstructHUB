import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ads-manager.tsx (Access invitations) and server/ads/routes.ts /invitations, server/ads/worker.ts as they run. */
const entry: HelpDraft = {
  key: "ads-manager.access-requests-in-bulk", parent: "ads-manager", group: "Google Ads", route: "/ads-manager", title: "Agency Ads & LSA → Access requests in bulk",
  whatItIs: "The Access invitations section of the Agency Ads & LSA manager, where you request manager access to client accounts and follow what happened to each request.",
  whatItDoes: "Request client account access takes one customer ID,email pair per line, up to 1,000 clients. Preview invitations shows how many invitations will go out, from which MCC, and the text each client receives. Confirm invitations and emails queues a pending Google manager invitation and a ConstructHUB instruction email for each line. The list shows every invitation with its status (Queued, Pending, Accepted, Rejected, Cancelled, Failed) and whether its email was sent; Cancel selected pending invitations withdraws the ticked ones.",
  howToUse: [
    "Sidebar → Google Ads → Agency → Access invitations.",
    "Under Request client account access, type one customer ID, a comma and the client’s email per line.",
    "Choose Preview invitations and read the review, then Confirm invitations and emails.",
    "To withdraw a request, tick a pending invitation in the list and choose Cancel selected pending invitations.",
  ],
  howItWorks: "The invitation itself is sent by Google from your MCC; the email from ConstructHUB only explains how to accept it in Google Ads (Admin → Access and security → Managers) and does not grant access. Clients can decline. Poll invitations asks Google for answers; the worker also polls on its own schedule, and an accepted client appears under Client accounts after the next Discover clients run.",
  needs: ["A plan that includes the Agency Ads & LSA module.", "A connected and verified Google Ads manager (MCC) account.", "Each client’s 10-digit Google Ads customer ID and an email address for its administrator."],
};
export default entry;
