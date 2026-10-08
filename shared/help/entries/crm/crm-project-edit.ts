import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-pipeline.tsx (EditProjectDialog) as it runs. */
const entry: HelpDraft = {
  key: "crm-project-edit", group: "CRM", route: "/crm/pipeline", title: "Put a value and a manager on a job",
  whatItIs: "The Edit project box behind the pencil on every pipeline card.",
  whatItDoes: "It changes a job’s name, contract value, stage and owner in one place. The card moves to the stage you pick and shows the new value, and the stage total and the pipeline value on Home count it.",
  howToUse: [
    "CRM → Pipeline. Click the pencil on the job’s card.",
    "Type the contract value. Change the name or the stage if you need to.",
    "Under Owner (PM), choose the team member who manages the job.",
    "Choose “Save changes”.",
  ],
  howItWorks: "The owner list is your team. Leaving the contract value blank clears it. Team members who cannot see prices do not get the contract value field.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "A job on the pipeline board.", "Team members, to pick an owner."],
};
export default entry;
