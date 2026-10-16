import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (Payments: payment methods, card fee) and server/crm/payments.ts as they run. */
const entry: HelpDraft = {
  key: "crm-payment-methods", group: "CRM", route: "/crm/settings", title: "Choose how clients can pay",
  whatItIs: "The rules for how clients may pay you online: bank transfer, card, or both.",
  whatItDoes: "“Payment methods you offer” sets the allowed methods, and with both allowed lets you make payments at or above an amount bank transfer only. “Pass the card processing fee to the client” adds a labelled fee line, at the percent you type, when a client pays an invoice by card from the invoice page.",
  howToUse: [
    "Open CRM → Settings and scroll to Payments.",
    "Choose the allowed methods under “Payment methods you offer”, and if you like, the amount above which only bank transfer is offered.",
    "Choose Save payment methods.",
    "Switch on the card fee to pass it on, type the percent and choose Save fee setting.",
  ],
  howItWorks: "Clients only see the methods you allow at checkout. Leave the amount blank to always offer both. Bank transfer and deposits never carry the card fee. While the fee is on, payment links you create offer bank transfer only.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Your own Stripe account, connected on the Payments page."],
};
export default entry;
