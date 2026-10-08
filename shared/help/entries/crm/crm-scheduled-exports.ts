import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (Scheduled exports) and the export routes as they run. */
const entry: HelpDraft = {
  key: "crm-scheduled-exports", group: "CRM", route: "/crm/settings", title: "Email yourself a regular export",
  whatItIs: "An export of your clients, estimates and invoices, emailed to you on a schedule.",
  whatItDoes: "Scheduled exports emails the export every week, every two weeks or every number of days you choose, as three CSV files or one Excel file with three sheets. “Send export now” sends one right away and the card shows when the last one went out.",
  howToUse: [
    "CRM → Settings, and scroll to Scheduled exports (the owner sees this card).",
    "Switch on Automatic email exports, then choose the frequency and the format.",
    "Leave “Send to” blank to use your company email, or type another address.",
    "Choose Save export settings. “Send export now” sends one immediately.",
  ],
  howItWorks: "An export holds clients, estimates and invoices. Attachments, signed documents, payments and other CRM records are not included, and an export cannot be restored back into the CRM. Due exports are checked every 15 minutes.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "You are the owner of the workspace."],
};
export default entry;
