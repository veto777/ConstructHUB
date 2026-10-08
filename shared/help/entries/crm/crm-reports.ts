import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-reports.tsx and server/crm/reports.ts as they run. */
const entry: HelpDraft = {
  key: "crm-reports", group: "CRM", route: "/crm/reports", title: "Import a measurement report",
  whatItIs: "The page that takes a HOVER or CladAI measurement report and files it on the right client.",
  whatItDoes: "You upload the report’s PDF or paste its text. The CRM reads the client’s name, email, phone and address and the roof measurements — squares, square feet, pitch, waste — and shows them for review. Confirming files the report on the client.",
  howToUse: [
    "CRM → Settings → Measurement reports → Open.",
    "Choose the PDF, or paste the report text, and choose Parse report.",
    "Check the client and the roof numbers under Review the import.",
    "Choose Confirm. Discard throws the draft away instead.",
  ],
  howItWorks: "Until you confirm, the report is a draft and nothing is created. On confirm the client is matched by email or phone; when there is no match a new client is created. The confirmed report is linked to the client’s record and visible in their portal. Some PDFs do not give up their text — paste the text instead.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
