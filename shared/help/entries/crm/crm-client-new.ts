import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-clients.tsx and crm-client.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-client-new", group: "CRM", route: "/crm/clients", title: "Add a client",
  whatItIs: "The New client form: a name, and whatever contact details you have.",
  whatItDoes: "Adds the client to your list and creates their private portal automatically. Notes typed here show as intake notes on the client's page, for your team only.",
  howToUse: [
    "CRM → Clients → New client.",
    "Type the client's name, then their email, phone and service address.",
    "Add notes for your team if you like, and choose Create client.",
    "Click the new name in the list to open the client's page.",
  ],
  howItWorks: "Only the name is required. If the email or phone already belongs to a client, the form names that client and lets you open them, or create a separate one anyway. On the client's page, Copy portal link copies the link to their portal.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
