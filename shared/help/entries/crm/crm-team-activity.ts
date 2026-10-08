import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-team.tsx (MemberActivity) and server/crm/activity.ts as they run. */
const entry: HelpDraft = {
  key: "crm-team-activity", group: "CRM", route: "/crm/team", title: "See what a team member has been doing",
  whatItIs: "An activity log under each person on the Team tab: what they did in the CRM, newest first, with the time.",
  whatItDoes: "Each line says who did what — for example that a team member recorded a payment, with the amount and the invoice. The log covers estimates, invoices, client changes, price book changes, payments, exports of the client list and team changes. A member with nothing logged shows “No activity recorded yet.”",
  howToUse: [
    "CRM → Team & Company → Team.",
    "Find the person and choose Activity under their name.",
    "Read the lines, newest first. Choose “Hide activity” to close the log.",
  ],
  howItWorks: "Only the account owner can open a member's activity log. Lines keep the name the person had at the time, so the history stays readable after someone is renamed or removed.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "You are the account owner."],
};
export default entry;
