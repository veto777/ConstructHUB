import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (the Calendar card), client/src/pages/crm-team.tsx and server/crm/calendar.ts as they run. */
const entry: HelpDraft = {
  key: "crm-google-calendar", group: "CRM", route: "/crm/settings", title: "Sync with Google Calendar",
  whatItIs: "The Calendar card in Settings, which pushes the CRM’s schedule into Google Calendar.",
  whatItDoes: "Once a Google account is connected, every appointment in the CRM is written into a calendar named “ConstructHub CRM” in that account. The card shows when it was connected and when it last synced, and “Sync now” pushes the schedule straight away.",
  howToUse: [
    "CRM → Settings, and scroll to the Calendar card.",
    "Under “Company Google Calendar”, choose “Connect Google Calendar” and sign in on Google’s own screen.",
    "Back in Settings the card reads Connected. Choose “Sync now” to push your schedule.",
    "For just your own appointments, connect your own calendar under Team & Company → My profile.",
  ],
  howItWorks: "The company calendar carries everyone’s appointments. A team member’s own calendar carries only theirs, and is separate. The same card also has a private feed link that any calendar app can subscribe to. Disconnect stops the sync.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "A Google account to hold the calendar."],
};
export default entry;
