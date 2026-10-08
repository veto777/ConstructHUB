import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (Payments: payment methods, card fee) and server/crm/payments.ts as they run. */
const entry: HelpDraft = {
  key: "crm-payment-methods", group: "CRM", route: "/crm/settings", title: "Choose how clients can pay",
  whatItIs: "The rules for how clients may pay you online: bank transfer, card, or both.",
  whatItDoes: "“Payment methods you offer” sets the allowed methods, and with both allowed lets you make payments at or above an amount bank transfer only. “Pass the card processing fee to the client” adds a labelled fee line to card checkouts, at the percent you type.",
  howToUse: [
    "CRM → Settings, and scroll to Payments.",
    "Under “Payment methods you offer”, choose the allowed methods and, if you like, the amount above which only bank transfer is offered.",
    "Choose Save payment methods.",
    "To pass on the card fee, switch it on, type the percent and choose Save fee setting.",
  ],
  howItWorks: "Clients only see the methods you allow at checkout. Leave the amount blank to always offer both. Bank transfer is never charged the card fee.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Your own Stripe account, connected on the Payments page."],
};
export default entry;
