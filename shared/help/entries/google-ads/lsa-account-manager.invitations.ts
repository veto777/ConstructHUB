import type { HelpDraft } from "../../types";

/** Written from client/src/pages/lsa-account-manager.tsx (InvitationsTab) and server/routes.ts /api/admin/lsa/invitations* as they run. */
const entry: HelpDraft = {
  key: "lsa-account-manager.invitations", parent: "lsa-account-manager", group: "Google Ads", route: "/lsa-account-manager", title: "LSA account manager → Invitations",
  whatItIs: "Where the central manager invites a client’s Google Ads account to link under it, and where each invitation’s answer is recorded.",
  whatItDoes: "New invitation takes the client’s customer ID, an optional name and notes; Send invitation asks Google to create a pending manager link and records the invitation. If Google refuses, the invitation is still saved and the error is shown. The list shows every invitation newest first with its status (pending, accepted, refused or cancelled) and the date. On a pending one, Mark accepted records the client’s acceptance and adds the account to Accounts as centrally linked. Cancel marks it cancelled here; it does not withdraw the invitation in Google Ads.",
  howToUse: [
    "Open /lsa-account-manager → Invitations and choose New invitation.",
    "Type the client’s 10-digit customer ID (digits only), a name if you like, and choose Send invitation.",
    "Ask the client to accept the manager-link invitation in their own Google Ads account.",
    "Choose Mark accepted on the invitation when they confirm, or Cancel to mark one cancelled here.",
  ],
  howItWorks: "The invitation itself lives in Google Ads: the client sees it under their account’s managers and decides there. This page does not learn the answer by itself; an admin marks it accepted once the client confirms, and that mark is what links the account here. Every send is written to the Audit log; marking an invitation accepted or cancelled is not.",
  needs: ["A ConstructHUB platform-admin account.", "A connected central manager (MCC)."],
};
export default entry;
