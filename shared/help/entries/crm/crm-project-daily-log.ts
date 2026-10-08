import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-project.tsx (Daily logs tab) as it runs. */
const entry: HelpDraft = {
  key: "crm-project-daily-log", group: "CRM", route: "/crm/pipeline", title: "Daily logs",
  whatItIs: "A dated record of what got done on a job each day.",
  whatItDoes: "A log holds what was done, the weather and how many crew were on the job. File log saves it under today’s date at the top of the list. Edit changes a log’s text, date, weather or crew count.",
  howToUse: [
    "CRM → Pipeline, open the project, and choose the Daily logs tab.",
    "Type what got done today.",
    "Add the weather and the number of crew.",
    "Choose File log.",
  ],
  howItWorks: "Any crew member can file a log and edit their own; anyone who manages jobs can edit them all.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
