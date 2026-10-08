import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-migrate.tsx (assisted path) and server/crm/migrate.ts as they run. */
const entry: HelpDraft = {
  key: "crm-migrate-assisted", group: "CRM", route: "/crm/migrate", title: "Ask us to move your data for you",
  whatItIs: "The hands-on option on the Import page: ask our team to move your data from another system for you.",
  whatItDoes: "You say which system you are leaving and add an optional note. The request is emailed to our team and the page confirms it was received.",
  howToUse: [
    "CRM → Clients → Import, and scroll to the bottom of the page.",
    "Choose the system you are on, or “Something else”.",
    "Add a note about what you have, such as how many clients and how many years of invoices.",
    "Choose “Request a hands-on migration”.",
  ],
  howItWorks: "Nothing is moved automatically: the request goes to a person, who contacts you to arrange it. Keep your old account active until everything has been confirmed. You can still import a CSV yourself on the same page.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
