import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx as it runs. */
const entry: HelpDraft = {
  key: "crm-client-edit", group: "CRM", route: "/crm/clients", title: "Edit or delete a client",
  whatItIs: "Edit changes a client's name, company, email, phone, address and intake notes. Delete removes a client for good.",
  whatItDoes: "Save changes updates the client's page straight away. Delete asks you to confirm; when the client has estimates, invoices, projects or calendar visits, it counts them and asks a second time before anything is removed.",
  howToUse: [
    "CRM → Clients, and click the client's name.",
    "Choose Edit, change what you need, and choose Save changes.",
    "To remove a client, choose Delete, then Delete permanently.",
    "If the CRM lists what the client still has, choose Delete everything to remove it all, or Cancel to keep the client.",
  ],
  howItWorks: "Only the workspace owner sees Delete. Deleting a client with work on file removes every estimate, invoice, project and visit under them, and it cannot be undone.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
