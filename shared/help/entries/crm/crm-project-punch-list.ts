import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-project.tsx (Punch list tab) as it runs. */
const entry: HelpDraft = {
  key: "crm-project-punch-list", group: "CRM", route: "/crm/pipeline", title: "Punch list",
  whatItIs: "The short list of things left to finish on a job, kept on the project.",
  whatItDoes: "Each punch item has a title and, if you want, a location. Items start open. Done crosses an item out and marks it done; Reopen brings it back.",
  howToUse: [
    "CRM → Pipeline, open the project, and choose the Punch list tab.",
    "Type the item, add a location, and click the plus button.",
    "Choose Done on an item when it is finished.",
    "Choose Reopen if it needs another look.",
  ],
  howItWorks: "The list belongs to the project, so everyone on the team who opens the project sees the same items.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
