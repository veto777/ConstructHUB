import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (the Calendar card), client/src/pages/crm-team.tsx and server/crm/calendar.ts as they run. */
const entry: HelpDraft = {
  key: "crm-google-calendar", group: "CRM", route: "/crm/settings", title: "Sync with Google Calendar",
  whatItIs: "The Calendar card in Settings, which pushes the CRM’s schedule into Google Calendar.",
  whatItDoes: "Once a Google account is connected, “Sync now” writes your CRM appointments into a calendar named “ConstructHub CRM” in that account. Nothing syncs on its own: Google is only updated when you choose “Sync now”. The card shows when it was connected and when it last synced, and “Sync now” sends up to 1,000 appointments each time.",
  howToUse: [
    "Open CRM → Settings and scroll to the Calendar card.",
    "Choose “Connect Google Calendar” under “Company Google Calendar” and sign in on Google’s own screen.",
    "Choose “Sync now” once the card reads Connected, to send your schedule to Google.",
    "Connect your own calendar under Team & Company → My profile for just your own appointments.",
  ],
  howItWorks: "The company calendar carries everyone’s appointments. A team member’s own calendar carries only theirs, and is separate. The same card also has a private feed link that any calendar app can subscribe to. Disconnect stops the sync.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "A Google account to hold the calendar."],
};
export default entry;
