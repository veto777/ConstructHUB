import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (Estimate & invoice defaults card) as it runs. */
const entry: HelpDraft = {
  key: "crm-document-defaults", group: "CRM", route: "/crm/settings", title: "Document defaults",
  whatItIs: "The wording and numbers every new estimate and invoice starts with.",
  whatItDoes: "The Estimate & invoice defaults card in Settings holds an estimate footer, an invoice footer, your terms and conditions, your warranty text, a default deposit percent and a default sales tax percent. They are pre-filled on every new document and can still be edited on each one.",
  howToUse: [
    "CRM → Settings, and scroll to Estimate & invoice defaults.",
    "Write the estimate and invoice footers, your terms and your warranty text.",
    "Set the default deposit percent, and a default sales tax percent if you want a fallback rate.",
    "Choose Save defaults.",
  ],
  howItWorks: "The default sales tax is only a fallback: it is used when no city or division rate matches the job. Defaults apply to documents created after you save; existing documents keep what they have.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Permission to manage company settings."],
};
export default entry;
