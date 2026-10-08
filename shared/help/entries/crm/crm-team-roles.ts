import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-team.tsx (Team tab) and PATCH /api/crm/members/:id as they run. */
const entry: HelpDraft = {
  key: "crm-team-roles", group: "CRM", route: "/crm/team", title: "Roles and permissions",
  whatItIs: "The role each person on your team has, and the switches that say what that person may see and do.",
  whatItDoes: "Every team member has a role — owner, admin, sales, pm (project manager), office, field or subcontractor — and a row of permission switches that start from that role. The “i” beside a role explains what it is for. You can change a person’s role, or flip one switch for one person.",
  howToUse: [
    "CRM → Team & Company → Team, and scroll to Team members.",
    "Click the “i” beside a role to read what that role is for.",
    "Pick a different role from the list to change it.",
    "Flip a single switch to allow or stop one thing for that one person.",
  ],
  howItWorks: "Roles set the defaults; a switch you flip overrides the role for that person only. The owner has every permission and cannot be changed here. The server checks the permission on every request, so a switch that is off is off everywhere.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Owner or admin access to manage the team."],
};
export default entry;
