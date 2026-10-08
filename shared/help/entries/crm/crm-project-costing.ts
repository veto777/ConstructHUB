import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-project.tsx (Costing tab) as it runs. */
const entry: HelpDraft = {
  key: "crm-project-costing", group: "CRM", route: "/crm/pipeline", title: "Post costs to a project",
  whatItIs: "The Costing tab of a project: what you planned to spend, what you have ordered and what you have been billed, by cost code.",
  whatItDoes: "The table lists each cost code with its Budget, Committed, Actual and Variance. The entry row above it adds a line: choose the kind of entry, pick the cost code, name the vendor, type the amount. A commitment raises Committed; a vendor bill raises Actual cost and changes the gross profit at the top of the page.",
  howToUse: [
    "CRM → Pipeline, open the project, and stay on the Costing tab.",
    "In the Entry list choose the kind of entry.",
    "Pick the cost code, type the vendor or a description, and the amount.",
    "Click the plus button. The table and the figures at the top update.",
  ],
  howItWorks: "Committed means purchase orders and subcontracts placed. Actual means vendor bills and labor posted. Gross profit is the revised contract minus the actual cost posted so far.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
