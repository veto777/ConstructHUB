import type { HelpDraft } from "../../types";

/** Written from client/src/pages/lsa-account-manager.tsx (AuditLogTab) and server/routes.ts /api/admin/lsa/audit-log as they run. */
const entry: HelpDraft = {
  key: "lsa-account-manager.audit-log", parent: "lsa-account-manager", group: "Google Ads", route: "/lsa-account-manager", title: "LSA account manager → Audit log",
  whatItIs: "The record of every change an admin made through the LSA account manager.",
  whatItDoes: "Each row shows when it happened, which admin did it, the action (connecting or disconnecting the manager, sending an invitation, syncing accounts or leads, changing a budget, pausing, enabling or renaming a campaign, disputing a lead), the account it was about, whether it succeeded, and the details sent or the error Google returned. The newest 100 entries are shown; Refresh audit reloads them.",
  howToUse: [
    "Open /lsa-account-manager → Audit log.",
    "Read the Result column: an error row carries Google’s message under Details.",
    "Choose Refresh audit after making a change elsewhere on the page.",
  ],
  howItWorks: "The server writes the entry at the moment of the action, success or error, so a failed connection attempt or a refused invitation is on record too. Reads (opening a list, loading campaigns) are not logged.",
  needs: ["A ConstructHUB platform-admin account."],
};
export default entry;
