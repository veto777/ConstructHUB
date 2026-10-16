import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx and crm-payments.tsx (Reverse on a recorded payment) as they run. */
const entry: HelpDraft = {
  key: "crm-payment-reverse", group: "CRM", route: "/crm/clients", title: "Reverse a payment",
  whatItIs: "The way to undo a payment that was recorded by mistake, without deleting anything.",
  whatItDoes: "Reverse on a recorded payment asks for a reason. The payment stays in the history marked “reversed”, with who reversed it and why. The client’s collected total stops counting it, and the invoice it paid gets its balance back.",
  howToUse: [
    "Open CRM → Clients and open the client.",
    "Choose Reverse on the payment under Payments.",
    "Type the reason, then choose Reverse payment.",
    "Check the list: the payment stays there, marked reversed.",
  ],
  howItWorks: "Reverse is on payments you recorded by hand that succeeded — a pending or failed payment has no Reverse button. The Payments page lists every payment with the same button.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "A payment recorded by hand.", "You are the account owner. Only the owner can reverse a payment."],
};
export default entry;
