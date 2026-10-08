import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-estimate-new.tsx, crm-estimates.tsx and crm-estimate-detail.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-estimate-draft", group: "CRM", route: "/crm/estimates/new", title: "Save an estimate and finish it later",
  whatItIs: "“Save as draft” on the last step of a new estimate: it keeps the estimate without sending anything to the client.",
  whatItDoes: "The draft gets its estimate number and is listed on the Estimates page with the status Draft. You open it from there, change it with Edit, and send it with Send when it is ready.",
  howToUse: [
    "CRM → Estimates → New estimate. Pick the client, add the work, and choose Review.",
    "Give it a title and choose “Save as draft” instead of “Send estimate”.",
    "Later, open Estimates and tick Draft to list your drafts.",
    "Open the draft, choose Edit to change it, then Send.",
  ],
  howItWorks: "A draft is not emailed and the client cannot see it. Sending it emails the client a private link and changes the status to Sent.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Price book items to pick from."],
};
export default entry;
