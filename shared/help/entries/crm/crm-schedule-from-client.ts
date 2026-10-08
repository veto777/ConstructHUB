import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx (Quick actions, the Schedule section and its dialog) as it runs. */
const entry: HelpDraft = {
  key: "crm-schedule-from-client", group: "CRM", route: "/crm/clients", title: "Book a visit from a client’s page",
  whatItIs: "A way to put a visit on the calendar without leaving the client you are looking at.",
  whatItDoes: "Schedule appointment on a client’s page opens a short form: a title, when it starts and ends, and optional notes. The visit is saved against that client, listed in the Schedule section of their page, and shown on the Schedule calendar.",
  howToUse: [
    "CRM → Clients, and open the client.",
    "Choose Schedule appointment under Quick actions.",
    "Give the visit a title and set when it starts and ends. Notes are optional.",
    "Choose Schedule. The visit is listed on the client’s page and on the calendar.",
  ],
  howItWorks: "The form opens on tomorrow at 9 AM for one hour, so you only change what differs. Click a visit in the client’s Schedule section to edit it.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
