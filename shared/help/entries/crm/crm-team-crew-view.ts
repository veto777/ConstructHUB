import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-team.tsx, crm-home.tsx and the CRM sidebar as they run for a member signed in with the field role. */
const entry: HelpDraft = {
  key: "crm-team-crew-view", group: "CRM", route: "/crm/team", title: "What your crew sees",
  whatItIs: "What the CRM looks like for a team member signed in with the field role, compared with what you see as the owner.",
  whatItDoes: "A field member has a shorter menu, with no Messages, Invoices, Integrations or Settings. With “See all jobs” off they see only the clients and projects of their own jobs, and with “See prices” off the totals show as a dash. Schedule and JobCam stay in their menu.",
  howToUse: [
    "CRM → Team & Company → Team, and find the person.",
    "Check the role beside their name. The invite form says what the field role sees.",
    "Use the switches under their name to turn one permission on or off for that person.",
  ],
  howItWorks: "A role sets the starting permissions and the switches override them for one person. The owner has every permission.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "A team member who has joined your team."],
};
export default entry;
