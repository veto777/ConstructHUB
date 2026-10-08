import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (Company profile card) as it runs. */
const entry: HelpDraft = {
  key: "crm-company-settings", group: "CRM", route: "/crm/settings", title: "Company profile and logo",
  whatItIs: "Your company’s name, contact details, address, license and logo, as they appear on estimates, invoices and the client portal.",
  whatItDoes: "The Company profile card in Settings holds the company name and legal entity, email, phone, website, logo, address, license number and state, industry and a short description. Save company profile stores them.",
  howToUse: [
    "CRM → Settings. Company profile is the first card.",
    "Check the name, email and phone your clients should use.",
    "Under Upload logo choose a PNG or JPG of 2 MB or less.",
    "Fill in the address and the license number and state, then choose Save company profile.",
  ],
  howItWorks: "The profile is shared by the whole workspace: it is what prints on your documents and shows in each client’s portal.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "Permission to manage company settings."],
};
export default entry;
