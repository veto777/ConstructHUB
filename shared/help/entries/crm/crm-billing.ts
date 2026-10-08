import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-team.tsx (Team tab, Seats card) as it runs. */
const entry: HelpDraft = {
  key: "crm-billing", group: "CRM", route: "/crm/team", title: "Seats on your CRM plan",
  whatItIs: "Where you see how many people your CRM plan has room for, and how many of those seats are in use.",
  whatItDoes: "The Seats card on the Team tab names your CRM plan, says how many seats it includes and how many are in use, and shows a “used of total” badge that is green while a seat is free.",
  howToUse: [
    "CRM → Team & Company → Team. Seats is the first card.",
    "Read the badge: seats used, out of the seats your plan includes.",
    "Scroll to Team members to see who is using them.",
  ],
  howItWorks: "You need a free seat to invite someone. Deactivated members do not use a seat, so removing someone from the team gives their seat back.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Owner or admin access to manage the team."],
};
export default entry;
