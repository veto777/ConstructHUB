import type { HelpDraft } from "../../types";

/** Written from client/src/components/crm-client-360.tsx (CustomerNotes, CustomerTimeline) as it runs. */
const entry: HelpDraft = {
  key: "crm-client-notes", group: "CRM", route: "/crm/clients", title: "Client notes and the activity timeline",
  whatItIs: "Two sections on every client's page: Notes, which your team writes, and Activity, which the CRM keeps for you.",
  whatItDoes: "Notes holds anything the team should remember about a client, and is never shown in the client's portal. Activity lists every send, open, visit, payment, message and change for that client, newest first.",
  howToUse: [
    "CRM → Clients, and click the client's name.",
    "Scroll to Notes, type the note and choose Add note.",
    "Use Edit or Delete beside a note to change or remove it.",
    "Read Activity, just above Notes, to see what has happened with the client.",
  ],
  howItWorks: "Each note is saved with its author and the time. Owners and admins can edit or delete any note; other team members only their own. Activity shows the ten newest entries first, with a button to show more.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
