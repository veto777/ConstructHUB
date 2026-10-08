import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-payments.tsx, client/src/components/crm-take-payment.tsx and server/crm/payments.ts as they run. */
const entry: HelpDraft = {
  key: "crm-payment-link", group: "CRM", route: "/crm/payments", title: "Send a payment link",
  whatItIs: "A secure link your client opens to pay an invoice online, by bank account or card.",
  whatItDoes: "Take a payment makes a checkout link for the balance of the invoice you pick. When the client pays, the payment appears under Recent payments and the invoice is marked Paid. A bank payment shows as processing until it clears.",
  howToUse: [
    "CRM → Payments. Under Take a payment, search for the client and choose them.",
    "Choose Take a payment, then pick the invoice.",
    "Choose “Create payment link”, and copy the link that appears.",
    "Text or email the link to your client. Recent payments shows the money when it lands.",
  ],
  howItWorks: "The link opens a checkout page hosted by Stripe on your own Stripe account, so the money goes straight to you. Only one link can be open for an invoice at a time.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Your Stripe account connected on the Payments page.", "An invoice with a balance."],
};
export default entry;
