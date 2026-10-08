import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-project.tsx (Costing tab) and server/crm/ops.ts as they run. */
const entry: HelpDraft = {
  key: "crm-project-budget", group: "CRM", route: "/crm/pipeline", title: "Set a job's budget",
  whatItIs: "A budget for one job, split by cost code, to compare with what you commit and spend.",
  whatItDoes: "On a job's Costing tab, an entry of type Budget adds a budget amount to a cost code. Each code gets a line showing Budget, Committed, Actual and Variance, and the Budget box at the top of the job adds the lines up.",
  howToUse: [
    "CRM → Pipeline, and open the job.",
    "On the Costing tab, choose Budget under Entry.",
    "Pick the cost code, type the amount, and click the plus button.",
    "Repeat for each code you want to track.",
  ],
  howItWorks: "Variance on a line is its budget minus its actual cost, and turns red when you have spent more than the budget. Purchase orders and bills are added with the same entry row, under the other Entry types.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Permission to see costs."],
};
export default entry;
