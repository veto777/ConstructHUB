import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-schedule.tsx as it runs. */
const entry: HelpDraft = {
  key: "crm-schedule-views", group: "CRM", route: "/crm/schedule", title: "Month, week and agenda",
  whatItIs: "Three ways to look at the Schedule: a month, one week, or a list of what is coming.",
  whatItDoes: "Month and Week draw the visits on a calendar, with arrows to move back and forward and a Today button to come back. Agenda lists the coming visits day by day for the next 7, 14 or 30 days, each with its time, project and crew. The list beside the views chooses whose visits you see: yours, everyone’s, or one team member’s.",
  howToUse: [
    "CRM → Schedule. It opens on Month.",
    "Use the arrows to move a month or a week at a time, and Today to come back.",
    "Choose Week for seven days side by side, or Agenda for a list.",
    "In Agenda, choose 7d, 14d or 30d to set how far ahead the list looks.",
    "Pick a name in the calendar list to see one person’s visits.",
  ],
  howItWorks: "The view you choose is kept in the page’s address, so a reload or a saved link opens the same view. Whose calendar you chose is remembered on this device.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
