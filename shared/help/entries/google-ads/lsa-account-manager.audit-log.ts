import type { HelpDraft } from "../../types";

/** Written from client/src/pages/lsa-account-manager.tsx (AuditLogTab) and server/routes.ts /api/admin/lsa/audit-log as they run. */
const entry: HelpDraft = {
  key: "lsa-account-manager.audit-log", parent: "lsa-account-manager", group: "Google Ads", route: "/lsa-account-manager", title: "LSA account manager → Audit log",
  whatItIs: "The record of the changes an admin made through the LSA account manager.",
  whatItDoes: "Each row shows when it happened, which admin did it, the account, whether it worked, and the details sent or Google’s error. Actions include connecting the manager, sending invitations, pulling accounts or leads, budget and campaign changes, and lead disputes. The newest 100 entries are shown, and Refresh audit reloads them.",
  howToUse: [
    "Open the LSA account manager (/lsa-account-manager) → Audit log.",
    "Read the Result column; an error row shows Google’s message under Details.",
    "Choose Refresh audit after making a change elsewhere on the page.",
  ],
  howItWorks: "For most actions the entry is written the moment it happens, success or error, so failed attempts are on record too. A disconnect, a refused dispute and marking an invitation accepted or cancelled are not logged. Just looking (opening a list, loading campaigns) is not logged.",
  needs: ["A ConstructHUB platform-admin account."],
};
export default entry;
