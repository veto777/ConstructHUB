import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-estimate-detail.tsx, client/src/components/crm-take-payment.tsx, client/src/pages/public-estimate.tsx and server/crm/payments.ts as they run. */
const entry: HelpDraft = {
  key: "crm-deposit-link", group: "CRM", route: "/crm/payments", title: "Collect a deposit on an approved estimate",
  whatItIs: "A way to take the deposit online as soon as a client approves an estimate.",
  whatItDoes: "An estimate can carry a deposit amount. Once the client approves it, their estimate page offers “Pay your deposit”, and Take a payment gives you a deposit link you can send yourself. The deposit then shows on your Payments page.",
  howToUse: [
    "Open the estimate, choose Edit, type the amount under “Deposit $” and save.",
    "The client approves the estimate on their page. It then offers “Pay your deposit”.",
    "To send the link yourself: open the client, choose “Take a payment”, then “Create deposit link” under “Deposit on a signed estimate”.",
    "Copy the link and text or email it. The payment appears under Recent payments.",
  ],
  howItWorks: "The link opens a checkout page hosted by Stripe on your own Stripe account. The deposit link is offered only for an approved estimate with a deposit that has not been paid and that has not been invoiced yet. A deposit cannot be more than the estimate total.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Your Stripe account connected on the Payments page.", "An approved estimate with a deposit amount."],
};
export default entry;
