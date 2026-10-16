import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (Estimate & invoice defaults card) as it runs. */
const entry: HelpDraft = {
  key: "crm-document-defaults", group: "CRM", route: "/crm/settings", title: "Document defaults",
  whatItIs: "The wording and numbers every new estimate and invoice starts with.",
  whatItDoes: "The Estimate & invoice defaults card in Settings holds your estimate and invoice footers, terms and conditions, and warranty text. It also holds a default deposit percent and a default sales tax percent. Today only the terms are copied onto each new estimate, where you can change them. The footers and the default deposit are saved but not used on documents yet.",
  howToUse: [
    "Open CRM → Settings and scroll to Estimate & invoice defaults.",
    "Write the estimate and invoice footers, your terms and your warranty text.",
    "Set the default deposit percent, and a default sales tax percent if you want a fallback rate.",
    "Choose Save defaults.",
  ],
  howItWorks: "The default sales tax is only a fallback: it is used when no city or division rate matches the job. An estimate keeps the terms it was created with. The warranty text and company terms on the client's estimate page and signed contract always show what Settings says now, on old estimates too.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Permission to manage company settings."],
};
export default entry;
