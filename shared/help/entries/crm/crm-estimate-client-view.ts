import type { HelpDraft } from "../../types";

/** Written from client/src/pages/public-estimate.tsx and crm-estimate-detail.tsx as they run in a recording slot. */
const entry: HelpDraft = {
  key: "crm-estimate-client-view", group: "CRM", route: "/crm/estimates", title: "What your client does with an estimate",
  whatItIs: "The page your client lands on when they open the link in the estimate email: your estimate laid out as a document, with a place to approve it.",
  whatItDoes: "The client reads your company details, who the estimate is prepared for, each line with its quantity and price, and the subtotal, tax and total. They approve by typing their full name and choosing “Approve this estimate”. The page then says “Approved — thank you!”, and in your CRM the estimate is marked approved.",
  howToUse: [
    "CRM → Estimates, open the estimate and choose Send. The line under the buttons shows when it was sent and whether it has been opened.",
    "Your client opens the link in the email and reads the estimate.",
    "Under “Ready to go ahead?” they type their full name and choose “Approve this estimate”.",
    "Open the estimate again in your CRM: it says who approved it, and that it is now a signed contract.",
  ],
  howItWorks: "An approved estimate can no longer be edited or deleted. When your payment account is connected, the client's page also shows a Pay button after they approve. Preview on the estimate's page shows you the same page with approving and paying switched off.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An estimate you have sent, and an email address on the client."],
};
export default entry;
