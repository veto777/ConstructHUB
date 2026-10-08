import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-project.tsx (Selections tab) as it runs. */
const entry: HelpDraft = {
  key: "crm-project-selections", group: "CRM", route: "/crm/pipeline", title: "Selections and allowances",
  whatItIs: "The choices a client still has to make on a job, each with the allowance you priced for it.",
  whatItDoes: "A selection has a name, a category and an allowance. Update records what the client chose, what it really cost and its status. When the actual cost is above the allowance, the line shows how much it is over.",
  howToUse: [
    "CRM → Pipeline, open the project, and choose the Selections tab.",
    "Type the selection, its category and the allowance, and click the plus button.",
    "When the client decides, choose Update on the line.",
    "Type the chosen option and the actual cost, set the status, and choose Save.",
  ],
  howItWorks: "The tab works out the overage from the allowance and the actual cost you typed. It shows the amount; it does not bill it for you.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
