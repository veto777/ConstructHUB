import type { HelpDraft } from "../../types";

/** Written from client/src/pages/public-invoice.tsx and server/crm/payments.ts as they run. */
const entry: HelpDraft = {
  key: "crm-invoice-client-view", group: "CRM", route: "/crm/invoices", title: "What your client sees on an invoice",
  whatItIs: "The page your client opens from the invoice you send: the invoice itself, and a way to pay it online.",
  whatItDoes: "The page shows your company, the invoice number, the amount due, who it is for, every line and the total. Under it, “Pay this invoice” takes the client to a secure checkout on your own Stripe account. After a bank payment the page reads “Payment processing” until the money clears; once paid it reads “Paid — thank you!”.",
  howToUse: [
    "CRM → Invoices, and open a sent invoice.",
    "Choose Preview to see the page as your client sees it. Paying is switched off in the preview.",
    "Your client opens the same page from the link in their email, after confirming their email address.",
    "They choose “Pay this invoice”, pay by bank or card, and come back to the invoice.",
  ],
  howItWorks: "The pay section only appears while there is a balance due. If no online payment method is available for the invoice, the page says so and shows your phone and email instead of a pay button.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An invoice sent to a client who has an email address.", "Your Stripe account connected on the Payments page, for online payment."],
};
export default entry;
