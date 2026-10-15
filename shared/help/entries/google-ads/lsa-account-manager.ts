import type { HelpDraft } from "../../types";

/** Written from client/src/pages/lsa-account-manager.tsx (ManagerConnectionTab) and server/routes.ts /api/admin/lsa/manager* as they run. */
const entry: HelpDraft = {
  key: "lsa-account-manager", group: "Google Ads", route: "/lsa-account-manager", title: "LSA account manager",
  whatItIs: "ConstructHUB’s own console for the client Google Ads accounts linked under its central manager (MCC) account; it is for ConstructHUB platform admins, not customers.",
  whatItDoes: "Manager connection shows whether the central MCC is connected, its manager ID, whether an API developer token is on file, when it was connected and last refreshed. Connect manager takes the MCC customer ID, a refresh token and an optional developer token; the token is checked with Google before anything is saved. Sync accounts pulls every child account of the MCC into the Accounts list and marks the ones running Local Services Ads. Reconfigure opens the same dialog; Disconnect marks the connection disconnected. The other sections are Accounts, Invitations and Audit log.",
  howToUse: [
    "Open /lsa-account-manager as a platform admin and pass the admin sign-in if it asks.",
    "Choose Connect manager, enter the MCC customer ID (digits only) and the refresh token, and choose Connect.",
    "Choose Sync accounts to pull the MCC’s client accounts into Accounts.",
    "Open Invitations to link more clients, and Audit log to see every change made here.",
  ],
  howItWorks: "A refresh token Google rejects is never saved as connected; the attempt is written to the audit log with Google’s message. The developer token falls back to the server’s own when the field is left blank. Advanced · Setup requirements lists what Google needs before any of this works: an MCC, a developer token, a published OAuth consent screen, an offline refresh token, and each client accepting the manager-link invitation in their own Google Ads account.",
  needs: ["A ConstructHUB platform-admin account.", "A Google Ads manager (MCC) account with API access."],
};
export default entry;
