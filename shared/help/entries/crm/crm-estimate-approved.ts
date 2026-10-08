import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-estimate-detail.tsx, crm-client.tsx and crm-clients.tsx as they run on an approved estimate. */
const entry: HelpDraft = {
  key: "crm-estimate-approved", group: "CRM", route: "/crm/estimates", title: "When a client approves an estimate",
  whatItIs: "What the CRM shows you once a client has approved an estimate — and what to do next.",
  whatItDoes: "The estimate’s page gets a banner naming who approved it, and the estimate becomes a signed contract that can no longer be edited or deleted. On the client’s page the estimate shows who approved it and when, the project moves to Approved by itself, and Create invoice appears on the estimate. The client is counted under Job Won on the Clients list.",
  howToUse: [
    "CRM → Estimates, tick Approved, and open the estimate.",
    "Read the banner: who approved it.",
    "Click the client’s name to see their estimate, their project and Create invoice.",
    "Choose Create invoice when you are ready to bill.",
  ],
  howItWorks: "The client approves on their private link by typing their full name. Sent and opened times stay on the estimate after approval.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An estimate a client has approved."],
};
export default entry;
