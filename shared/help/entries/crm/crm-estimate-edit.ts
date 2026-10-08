import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-estimate-detail.tsx (the editor, Save changes, Resend, History) as it runs. */
const entry: HelpDraft = {
  key: "crm-estimate-edit", group: "CRM", route: "/crm/estimates", title: "Edit and resend an estimate",
  whatItIs: "The editor on an estimate’s page, for when a client asks for a change after you have sent it.",
  whatItDoes: "Edit opens the title, tax percent, deposit, your message and every line — name, kind, quantity, unit, price, scope of work, taxable, hidden from client. The total updates as you type. Save changes puts the new version on the client’s link straight away; Resend emails the client again.",
  howToUse: [
    "CRM → Estimates, then click the estimate’s number.",
    "Choose Edit and change a line, or choose Add line.",
    "Check the total, then choose Save changes.",
    "Choose Resend to email the client. History lists the update and the send.",
  ],
  howItWorks: "Saving does not email anyone — the client’s link simply shows the new version. Resend sets a new sent time and a new valid-until date. An approved estimate has no Edit button.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An estimate that is not approved yet.", "An email address on the client, to resend to."],
};
export default entry;
