import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-project.tsx as it runs. */
const entry: HelpDraft = {
  key: "crm-project", group: "CRM", route: "/crm/pipeline", title: "Read a project page",
  whatItIs: "One page per job, with its money at the top and its working lists in tabs.",
  whatItDoes: "The top of the page shows the project’s name, number and stage, then four figures: Revised contract (with the change orders in it), Budget, Committed and Actual cost. Gross profit is the revised contract minus the actual cost posted so far, with the margin beside it. The tabs below are Costing, Change orders, Punch list, Daily logs, Selections, Permits and JobCam.",
  howToUse: [
    "CRM → Pipeline, and click a project’s name on its card.",
    "Read the four figures and the gross profit line.",
    "Open a tab to work on that part of the job.",
    "Choose Pipeline at the top of the page to go back to the board.",
  ],
  howItWorks: "Until a cost is posted, the gross profit line says so instead of showing a margin. The figures are only shown to team members who are allowed to see costs.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
