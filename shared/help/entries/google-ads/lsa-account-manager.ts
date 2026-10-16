import type { HelpDraft } from "../../types";

/** Written from client/src/pages/lsa-account-manager.tsx (ManagerConnectionTab) and server/routes.ts /api/admin/lsa/manager* as they run. */
const entry: HelpDraft = {
  key: "lsa-account-manager", group: "Google Ads", route: "/lsa-account-manager", title: "LSA account manager",
  whatItIs: "ConstructHUB’s own console for the client Google Ads accounts linked under its central manager account (the MCC). It is for ConstructHUB platform admins, not customers.",
  whatItDoes: "Manager connection shows whether the central manager account is connected, its manager ID, whether a developer token (Google’s key for software access) is on file, and when it was connected and last refreshed. Connect manager takes the manager account’s customer ID, a refresh token and an optional developer token, checked with Google before anything is saved. Sync accounts pulls every client account into the Accounts list and marks the ones running Local Services Ads. Reconfigure opens the same dialog, Disconnect marks the connection disconnected, and the other sections are Accounts, Invitations and Audit log.",
  howToUse: [
    "Open /lsa-account-manager as a platform admin and pass the admin sign-in if it asks.",
    "Choose Connect manager, type the manager account’s customer ID (digits only) and the refresh token, and choose Connect.",
    "Choose Sync accounts to pull the manager account’s client accounts into Accounts.",
    "Open Invitations to link more clients, and Audit log to see every change made here.",
  ],
  howItWorks: "A refresh token Google rejects is never saved as connected; the attempt is written to the audit log with Google’s message. The developer token falls back to the server’s own when the field is left blank. Advanced · Setup requirements lists what Google needs first: a manager account, a developer token, a published Google sign-in screen (OAuth consent screen) and a saved long-term sign-in. Each client must also accept the manager invitation in their own Google Ads account.",
  needs: ["A ConstructHUB platform-admin account.", "A Google Ads manager (MCC) account with API access."],
};
export default entry;
