import type { HelpDraft } from "../../types";

/** Written from client/src/components/crm-receipt.tsx, client/src/pages/crm-settings.tsx and server/crm/receipts.ts as they run. */
const entry: HelpDraft = {
  key: "crm-invoice-receipt", group: "CRM", route: "/crm/clients", title: "Send a receipt",
  whatItIs: "A receipt for an invoice: every payment received on it so far, and what is still owing.",
  whatItDoes: "The Receipt button on an invoice opens the receipt to date — the invoice lines, each payment with its date and method, the total paid and the balance owing — and “Send receipt” emails it to the client.",
  howToUse: [
    "CRM → Clients, and open the client.",
    "Under Invoices, choose Receipt on the invoice.",
    "Read the receipt: payments received, total paid, balance owing.",
    "Choose “Send receipt”. It goes to the email address on the client’s file.",
  ],
  howItWorks: "An invoice with no payment on it has nothing to receipt. When the invoice is paid in full the receipt says so. A receipt is also emailed on its own when a payment is recorded, as long as “Payment receipts” is switched on in Settings. The same Receipt button is on the Invoices page for invoices that have a payment.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An invoice with at least one payment.", "An email address on the client."],
};
export default entry;
