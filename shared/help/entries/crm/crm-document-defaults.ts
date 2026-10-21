import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (Estimate & invoice defaults card) as it runs. */
const entry: HelpDraft = {
  key: "crm-document-defaults", group: "CRM", route: "/crm/settings", title: "Document defaults",
  whatItIs: "The wording and numbers every new estimate and invoice starts with.",
  whatItDoes: "The Estimate & invoice defaults card in Settings holds your estimate and invoice footers, terms and conditions, warranty text and bid headline. It also holds a default deposit percent and a default sales tax percent. A new estimate copies the footer, warranty text, terms and default deposit onto itself, where you can change them. The bid headline is a banner that opens every estimate, above the scopes and line items.",
  howToUse: [
    "Open CRM → Settings and scroll to Estimate & invoice defaults.",
    "Write the estimate and invoice footers, your terms and your warranty text.",
    "To open every bid with a claim, fill in Bid headline, and put its conditions and limits on the smaller line under it. Leave it blank to show none.",
    "Set the default deposit percent, and a default sales tax percent if you want a fallback rate.",
    "Choose Save defaults.",
  ],
  howItWorks: "The default sales tax is only a fallback: it is used when no city or division rate matches the job. An estimate keeps the terms it was created with. The warranty text and terms an estimate copied stay with it, so editing Settings changes only estimates created after the save; estimates from before copies existed still show what Settings says now. The bid headline is read live: it shows on every estimate page and estimate email, old estimates too, with a link to that estimate's warranty, and a signed contract keeps the headline it was signed with.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Permission to manage company settings."],
};
export default entry;
