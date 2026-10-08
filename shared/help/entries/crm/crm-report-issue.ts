import type { HelpDraft } from "../../types";

/** Written from client/src/pages/report-issue.tsx (CrmReportIssuePage) and server/ops/user-reports.ts as they run. */
const entry: HelpDraft = {
  key: "crm-report-issue", group: "CRM", route: "/crm/report-issue", title: "Report an issue from the CRM",
  whatItIs: "The form for telling ConstructHUB that something in the CRM is not working, without leaving the CRM.",
  whatItDoes: "You say what you were trying to do, what happened instead, which page it was on and how bad it is, and can attach one screenshot. Sending it gives you a report number, and the report is listed under “Your reports” with its status and our reply.",
  howToUse: [
    "At the bottom of any CRM page, choose Report an issue.",
    "Fill in what you were trying to do and what happened instead. Leave out passwords and card numbers.",
    "Check “Which page?” — it is filled in from the page you came from — and pick how bad it is.",
    "Choose Send report, then follow it under “Your reports”.",
  ],
  howItWorks: "The page, your browser, your window size and the time are sent with the report so the problem can be reproduced; “What we send with your report” lists them before you send. Reports that stop you from working are looked at first.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
