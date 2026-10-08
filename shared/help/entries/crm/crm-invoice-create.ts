import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx (Create invoice, Send, Preview) and crm-create-menu.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-invoice-create", group: "CRM", route: "/crm/invoices", title: "Create and send an invoice",
  whatItIs: "Turning an approved estimate into an invoice, checking it, and sending it to the client.",
  whatItDoes: "Create invoice on an approved estimate makes a draft invoice with the same title and total. Preview shows the client’s view — your company details, the amount due and the due date. Send emails the client a link and marks the invoice Sent; Record payment stays on the invoice for when the money comes in.",
  howToUse: [
    "CRM → Clients, then open the client.",
    "Under Estimates, choose Create invoice on the approved estimate.",
    "Under Invoices, choose Preview to check the draft.",
    "Choose Send.",
  ],
  howItWorks: "The estimate then shows “Invoiced” with the invoice’s number in place of the button. To bill without an estimate, Create → Invoice starts a draft for the client you pick.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An approved estimate.", "An email address on the client, to send to."],
};
export default entry;
