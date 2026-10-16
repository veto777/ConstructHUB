import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-directories.tsx and client/src/components/directories/common.tsx as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-directories", group: "Tools", route: "/admin/directories", title: "Directory Sync admin",
  whatItIs: "A page for the people who run ConstructHUB: the directory catalogue and every account’s directory profiles.",
  whatItDoes: "Directories shows the catalogue with research coverage, lets you add or edit a directory and control which ones accept profile URLs. Profiles lists business profiles across all accounts with their total, live and billable counts. Directory profiles lists every directory profile across accounts, whatever its status, with a status filter and a Recheck button.",
  howToUse: [
    "Open the Directories tab to add or edit a directory.",
    "Open Profiles to see each account’s profiles and their counts.",
    "Open Directory profiles to review verification across accounts.",
  ],
  howItWorks: "Every tab reads admin-only data the server refuses to anyone who is not a platform admin; verification counts come from the directory profile checker.",
  needs: ["Platform admin access."],
};
export default entry;
