import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx (the New estimate dialog on a client page) as it runs. */
const entry: HelpDraft = {
  key: "crm-estimate-quick", group: "CRM", route: "/crm/clients", title: "A quick estimate from the client's page",
  whatItIs: "A short estimate form that opens on the client’s own page, for a job with only a few lines.",
  whatItDoes: "You give the estimate a title and type each line: what the work is, a quantity, a unit price and the scope the client will read. The line totals, subtotal and total add up as you type. “Create estimate” saves it on the client’s page, where you can preview and send it.",
  howToUse: [
    "CRM → Clients, and open the client.",
    "Choose “New estimate” under Quick actions.",
    "Type a title, then each line: item, quantity, unit price and scope. “Add line” gives you another.",
    "Choose “Create estimate”. It appears under Estimates on the client’s page.",
  ],
  howItWorks: "A line with no item name is left out, and at least one line is needed. For a larger job, the full builder lets you add work from your price book instead of typing each line.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "A client to write the estimate for."],
};
export default entry;
