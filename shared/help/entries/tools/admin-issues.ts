import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-issues.tsx and shared/ops-issues.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-issues", group: "Tools", route: "/admin/issues", title: "Issues (admin)",
  whatItIs: "A page for the people who run ConstructHUB: the issue desk, with every failure the app captured and every report a person sent from Report an issue.",
  whatItDoes: "Status chips with counts filter the list, and a second filter narrows it by source. Each row shows severity, title, source or reporter, how many times it happened and when it was last seen. Opening a row shows the detail, Claude’s report, the timeline, and for a user report the person’s own words, their diagnostics and a reply box the reporter reads under Your reports. Buttons mark an issue fixed, ignored (Not a bug for a user report) or send it back for inspection; a signed-out visitor’s report waits in triage until you press Send to Claude.",
  howToUse: [
    "Pick a status chip, then a source if you want fewer rows.",
    "Open a row and read the report and the timeline.",
    "Write a plain-language reply for a user report and save it.",
    "Mark the issue fixed, ignored or re-inspect.",
  ],
  howItWorks: "The list refreshes every minute while the page is open. The issue desk on the tower picks up new issues every 15 minutes and takes user reports before captured errors, blockers first. A disk-space warning appears at the top when the server volume runs low.",
  needs: ["Platform admin access and a recent identity check."],
};
export default entry;
