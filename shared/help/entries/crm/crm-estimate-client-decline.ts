import type { HelpDraft } from "../../types";

/** Written from client/src/pages/public-estimate.tsx (decline), crm-estimate-detail.tsx and server/crm/portal.ts as they run. */
const entry: HelpDraft = {
  key: "crm-estimate-client-decline", group: "CRM", route: "/crm/estimates", title: "When a client declines",
  whatItIs: "What a client does to decline an estimate, and what you see when they do.",
  whatItDoes: "On the estimate page the client chooses Decline, can type a reason, and confirms. The estimate's status changes to declined in your Estimates list, and its page shows when it was declined and the reason given.",
  howToUse: [
    "Your client opens the estimate and chooses Decline, beside the Approve button.",
    "They can type a reason, then choose Confirm decline.",
    "In the CRM, open Estimates: the estimate's status reads declined.",
    "Open it to read the date and the reason. Edit and Resend to make a new offer.",
  ],
  howItWorks: "The client's page tells them you have been notified. A declined estimate can still be edited; sending it again puts it back in front of the client.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An estimate that has been sent to the client."],
};
export default entry;
