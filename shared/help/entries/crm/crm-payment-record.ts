import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx (Invoices → Record payment) as it runs. */
const entry: HelpDraft = {
  key: "crm-payment-record", group: "CRM", route: "/crm/clients", title: "Record a check or cash payment",
  whatItIs: "How you tell the CRM about money a client paid you directly — a check, cash, a wire or a card taken another way.",
  whatItDoes: "Record payment on an invoice takes the amount, the method and an optional note such as a check number. The amount starts at what is still due. Saving updates the invoice, the client’s outstanding balance and the amount collected, and lists the payment under Payments on the client’s page.",
  howToUse: [
    "CRM → Clients, then open the client.",
    "Under Invoices, choose Record payment on the invoice.",
    "Check the amount, pick the method and add a note.",
    "Choose Record. The invoice shows what is paid and what is still due.",
  ],
  howItWorks: "A payment for less than what is due leaves the invoice Partial; paying the rest marks it Paid. A recorded payment can be reversed from the Payments list if it was entered by mistake.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An invoice with a balance due."],
};
export default entry;
