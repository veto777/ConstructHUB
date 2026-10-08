import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-team.tsx (the member card) and server/crm/routes.ts as they run. */
const entry: HelpDraft = {
  key: "crm-team-cost-rate", group: "CRM", route: "/crm/team", title: "Set a crew member's hourly cost",
  whatItIs: "“Cost rate / hr” on a team member's card: what an hour of that person's time costs your company.",
  whatItDoes: "You type the rate on the person's card on the Team tab and it saves when you leave the field; “Team member updated” confirms it. Clearing the field removes the rate.",
  howToUse: [
    "CRM → Team & Company → Team, and find the person's card.",
    "Click “Cost rate / hr” and type the hourly cost.",
    "Press Tab or click anywhere else. It saves by itself.",
  ],
  howItWorks: "The field shows only to people who have “See costs and margins” and “Manage team and invitations” switched on, and cost rates are sent only to people who can see costs. The owner's own card has no cost rate.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Permission to see costs and to manage the team."],
};
export default entry;
