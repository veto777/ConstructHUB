import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx (Projects section) and crm-pipeline.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-project-new", group: "CRM", route: "/crm/clients", title: "Start a project for a client",
  whatItIs: "A new job for a client you already have, started from their page.",
  whatItDoes: "New project in the Projects section of a client’s page asks for one thing: the project’s name. The project gets the next project number, is listed on the client’s page, and gets a card on the Pipeline board.",
  howToUse: [
    "CRM → Clients, and open the client.",
    "In the Projects section choose New project.",
    "Type the project name and choose Create project.",
    "Click the project to open its page, or find its card on the Pipeline.",
  ],
  howItWorks: "A client can have more than one project. Approving an estimate moves its project to Approved automatically.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
