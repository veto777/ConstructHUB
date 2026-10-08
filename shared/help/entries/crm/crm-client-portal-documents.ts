import type { HelpDraft } from "../../types";

/** Written from client/src/pages/client-portal.tsx (Signed contracts, Measurement reports) as it runs. */
const entry: HelpDraft = {
  key: "crm-client-portal-documents", group: "CRM", route: "/crm/clients", title: "Signed contracts and reports in the portal",
  whatItIs: "The parts of the client portal that keep a client's paperwork: signed contracts and measurement reports.",
  whatItDoes: "Signed contracts lists every estimate the client approved, with who signed, when and its value, and opens the signed document. Measurement reports lists the reports for their property with links to the 3D model and the measurement PDF.",
  howToUse: [
    "The client signs in to their portal.",
    "They choose Signed contracts to see what they approved, and open one by its name.",
    "They choose Measurement reports to open the 3D model or the PDF.",
    "Estimates and “Invoices & receipts” in the same menu hold everything else you sent.",
  ],
  howItWorks: "An estimate appears under Signed contracts once the client has approved it. A measurement report appears once it is on the client's page in the CRM. You can check what a client sees with “See what the client sees” on their page.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
