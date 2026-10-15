import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ads-manager.tsx (Access invitations) and server/ads/routes.ts /invitations, server/ads/worker.ts as they run. */
const entry: HelpDraft = {
  key: "ads-manager.access-requests-in-bulk", parent: "ads-manager", group: "Google Ads", route: "/ads-manager", title: "Agency Ads & LSA → Access requests in bulk",
  whatItIs: "The Access invitations section of the Agency Ads & LSA manager. Here you ask for manager access to client accounts and follow what happened to each request.",
  whatItDoes: "Request client account access takes one customer ID,email pair per line, up to 1,000 clients. Preview invitations shows how many invitations will go out, from which manager account (the MCC), and the text each client receives. Confirm invitations and emails sends a pending Google manager invitation and a ConstructHUB instruction email for each line. The list shows every invitation with its status (Queued, Pending, Accepted, Rejected, Cancelled, Failed) and whether its email was sent; Cancel selected pending invitations withdraws the ticked ones.",
  howToUse: [
    "Open Google Ads → Agency → Access invitations in the sidebar.",
    "Type one customer ID, a comma and the client’s email per line under Request client account access.",
    "Choose Preview invitations and read the review, then Confirm invitations and emails.",
    "Tick a pending invitation in the list and choose Cancel selected pending invitations to withdraw it.",
  ],
  howItWorks: "The invitation itself is sent by Google from your manager account; the email from ConstructHUB only explains how to accept it in Google Ads (Admin → Access and security → Managers) and does not grant access. Clients can decline. Poll invitations asks Google for answers, and the server also asks on its own schedule. An accepted client appears under Client accounts after the next Discover clients run.",
  needs: ["A plan that includes the Agency Ads & LSA module.", "A connected and verified Google Ads manager (MCC) account.", "Each client’s 10-digit Google Ads customer ID and an email address for its administrator."],
};
export default entry;
