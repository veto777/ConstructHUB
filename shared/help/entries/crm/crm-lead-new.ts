import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-pipeline.tsx, crm-home.tsx and server/crm/follow-ups.ts as they run. */
const entry: HelpDraft = {
  key: "crm-lead-new", group: "CRM", route: "/crm/pipeline", title: "Add a lead",
  whatItIs: "New lead on the Pipeline: a job you have not won yet, added as a card in the first stage.",
  whatItDoes: "Creates the lead for a new client or one you already have, with an estimated value if you know it. The card lands in the Lead column, and Home lists it under Needs attention.",
  howToUse: [
    "CRM → Pipeline → New lead.",
    "Type a lead name that says who and what job.",
    "Choose New client and type their name, or choose Existing client and search for them.",
    "Add an estimated value if you have one, and choose Add to pipeline.",
  ],
  howItWorks: "A lead is a project in the first pipeline stage. Choosing New client also adds that person to your client list. Home shows the lead as new for its first two weeks, and under Needs an estimate until the lead or its client has an estimate.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
