import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-project.tsx (Permits tab) as it runs. */
const entry: HelpDraft = {
  key: "crm-project-permits", group: "CRM", route: "/crm/pipeline", title: "Find the permit office for a job",
  whatItIs: "The Permits tab of a project: the official permit portal on file for the place the job is in.",
  whatItDoes: "The tab matches the project’s city and state to the permit portals ConstructHUB has on file and lists them, with a note on when each link was last checked. Open portal goes to that office’s own website.",
  howToUse: [
    "CRM → Pipeline, open the project, and choose the Permits tab.",
    "Read “Matched on” to see which place the job was matched to.",
    "Choose Open portal to go to the office’s website.",
  ],
  howItWorks: "The match comes from the job’s address. When there is no official portal on file for a place, the tab says so instead of showing a guessed link.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
