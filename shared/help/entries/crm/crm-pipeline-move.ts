import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-pipeline.tsx as it runs. */
const entry: HelpDraft = {
  key: "crm-pipeline-move", group: "CRM", route: "/crm/pipeline", title: "Move a job to the next stage",
  whatItIs: "Two ways to move a job along the pipeline: the stage menu on its card, or dragging the card to another column.",
  whatItDoes: "Choosing a stage moves the card to that column at once. The pencil on a card opens Edit project, where you can change the name, the contract value, the stage and the owner together.",
  howToUse: [
    "CRM → Pipeline.",
    "Open the stage menu at the bottom of a card and choose the new stage, or drag the card to that column.",
    "To change more than the stage, click the pencil on the card.",
    "Set the stage, the owner and the contract value, and choose Save changes.",
  ],
  howItWorks: "When a client approves an estimate, its project moves to Approved by itself. Moving cards needs a role that can manage jobs.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
