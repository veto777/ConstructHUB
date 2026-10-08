import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-clients.tsx and server/crm/entities.ts (GET /api/crm/customers/export.csv) as they run. */
const entry: HelpDraft = {
  key: "crm-client-export", group: "CRM", route: "/crm/clients", title: "Export your client list",
  whatItIs: "Export CSV on the Clients page: your client list as a spreadsheet file.",
  whatItDoes: "Downloads one file with a row for every client: name, email, phone, address, city, state, ZIP, intake notes and the date they were added, sorted by name.",
  howToUse: [
    "CRM → Clients.",
    "Choose Export CSV. Your browser saves the file.",
    "Open the file in your spreadsheet program.",
  ],
  howItWorks: "The export is the whole list, whatever tab or search is showing. Only team members whose role allows exporting see the button, and each export is logged. Import, beside it, opens the page for bringing clients in from another system.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
